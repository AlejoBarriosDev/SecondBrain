import { PrismaClient } from "@prisma/client";
import { AppError } from "@/lib/api/errors";
import { prisma as defaultPrisma } from "@/lib/db/prisma";

export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_FULL_SCOPE = "https://mail.google.com/";
export const MAX_PDF_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_BUFFER_MS = 60_000;
const MAX_MIME_DEPTH = 16;

export class GmailNotConnectedError extends AppError {
  constructor(
    message = "Google account with Gmail access is not connected. Sign in with Google to enable Gmail sync.",
  ) {
    super("GMAIL_NOT_CONNECTED", message, 412);
  }
}

export class GmailScopeMissingError extends AppError {
  constructor(
    message = `Connected Google account is missing required scope (${GMAIL_READONLY_SCOPE}).`,
  ) {
    super("GMAIL_SCOPE_MISSING", message, 403);
  }
}

export class GmailHistoryExpiredError extends AppError {
  constructor(
    message = "Gmail history cursor has expired and requires a full listing resync.",
  ) {
    super("GMAIL_HISTORY_EXPIRED", message, 404);
  }
}

export class GmailApiError extends AppError {
  constructor(message: string, status = 502) {
    super("GMAIL_API_ERROR", message, status);
  }
}

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

export interface GmailMessageRef {
  id: string;
  threadId?: string;
}

export interface GmailListMessagesResult {
  messages: GmailMessageRef[];
  nextPageToken?: string;
}

export interface GmailHistoryResult {
  messageIds: string[];
  historyId?: string;
}

export interface GmailAttachmentMeta {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface GmailMessageDetail {
  id: string;
  threadId?: string;
  fromAddress: string | null;
  subject: string | null;
  receivedAt: Date;
  snippet: string | null;
  bodyText: string;
  pdfAttachments: GmailAttachmentMeta[];
}

export interface IGmailClient {
  getProfile(userId: string): Promise<GmailProfile>;
  listMessages(
    userId: string,
    params?: { query?: string; maxResults?: number; pageToken?: string },
  ): Promise<GmailListMessagesResult>;
  listHistory(
    userId: string,
    startHistoryId: string,
  ): Promise<GmailHistoryResult>;
  getMessage(userId: string, messageId: string): Promise<GmailMessageDetail>;
  getAttachment(
    userId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer>;
}

export interface GmailRestClientOptions {
  prisma?: Pick<PrismaClient, "account">;
  fetchFn?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
}

interface RawGmailHeader {
  name?: string;
  value?: string;
}

interface RawGmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: RawGmailHeader[];
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: RawGmailPart[];
}

interface RawGmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: RawGmailPart;
}

export function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasGmailScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  const scopes = scope
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    scopes.includes(GMAIL_READONLY_SCOPE) || scopes.includes(GMAIL_FULL_SCOPE)
  );
}

function extractHeader(
  headers: RawGmailHeader[] | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  const found = headers.find((h) => h.name?.toLowerCase() === target);
  return found?.value?.trim() || null;
}

function traverseMimeParts(
  part: RawGmailPart | undefined,
  depth: number,
  acc: {
    plainTexts: string[];
    htmlTexts: string[];
    pdfAttachments: GmailAttachmentMeta[];
  },
): void {
  if (!part || depth > MAX_MIME_DEPTH) {
    return;
  }

  const mimeType = (part.mimeType ?? "").toLowerCase();
  const filename = (part.filename ?? "").trim();

  const isPdf =
    mimeType === "application/pdf" ||
    (filename.length > 0 && filename.toLowerCase().endsWith(".pdf"));

  if (isPdf && part.body?.attachmentId) {
    acc.pdfAttachments.push({
      attachmentId: part.body.attachmentId,
      fileName: filename || "attachment.pdf",
      mimeType: mimeType || "application/pdf",
      sizeBytes: typeof part.body.size === "number" ? part.body.size : 0,
    });
  } else if (mimeType === "text/plain" && part.body?.data) {
    const decoded = decodeBase64Url(part.body.data).toString("utf8").trim();
    if (decoded) {
      acc.plainTexts.push(decoded);
    }
  } else if (mimeType === "text/html" && part.body?.data) {
    const decoded = decodeBase64Url(part.body.data).toString("utf8").trim();
    if (decoded) {
      acc.htmlTexts.push(decoded);
    }
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      traverseMimeParts(child, depth + 1, acc);
    }
  }
}

export class GmailRestClient implements IGmailClient {
  private readonly prisma: Pick<PrismaClient, "account">;
  private readonly fetchFn: typeof fetch;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;

  constructor(options: GmailRestClientOptions = {}) {
    this.prisma = options.prisma ?? defaultPrisma;
    this.fetchFn = options.fetchFn ?? fetch;
    this.clientId = (
      options.clientId ??
      process.env.GOOGLE_CLIENT_ID ??
      ""
    ).trim();
    this.clientSecret = (
      options.clientSecret ??
      process.env.GOOGLE_CLIENT_SECRET ??
      ""
    ).trim();
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async resolveAccessToken(
    userId: string,
    forceRefresh = false,
  ): Promise<string> {
    const account = await this.prisma.account.findFirst({
      where: { userId, providerId: "google" },
    });

    if (!account) {
      throw new GmailNotConnectedError();
    }

    if (!hasGmailScope(account.scope)) {
      throw new GmailScopeMissingError();
    }

    const now = Date.now();
    const expiresAtMs = account.accessTokenExpiresAt
      ? account.accessTokenExpiresAt.getTime()
      : null;

    const isTokenFresh =
      !forceRefresh &&
      Boolean(account.accessToken) &&
      (expiresAtMs === null || expiresAtMs - now > TOKEN_REFRESH_BUFFER_MS);

    if (isTokenFresh && account.accessToken) {
      return account.accessToken;
    }

    if (!account.refreshToken) {
      throw new GmailNotConnectedError(
        "Google OAuth access token expired and no refresh token is available. Please reconnect Google.",
      );
    }

    if (!this.clientId || !this.clientSecret) {
      throw new GmailApiError(
        "Google OAuth client credentials are not configured for token refresh.",
        500,
      );
    }

    const form = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    });

    const tokenRes = await this.fetchFn(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      throw new GmailApiError(
        `Failed to refresh Google OAuth token (HTTP ${tokenRes.status}): ${errText.slice(0, 200)}`,
        tokenRes.status === 400 || tokenRes.status === 401 ? 412 : 502,
      );
    }

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };

    if (!tokenData.access_token) {
      throw new GmailApiError("Google token refresh did not return access_token");
    }

    const nextExpiresAt =
      typeof tokenData.expires_in === "number"
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null;

    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        accessToken: tokenData.access_token,
        ...(nextExpiresAt ? { accessTokenExpiresAt: nextExpiresAt } : {}),
        ...(tokenData.refresh_token
          ? { refreshToken: tokenData.refresh_token }
          : {}),
        ...(tokenData.scope ? { scope: tokenData.scope } : {}),
      },
    });

    return tokenData.access_token;
  }

  private async gmailRequest<T>(
    userId: string,
    path: string,
    options?: { throwHistoryExpiredOn404?: boolean },
  ): Promise<T> {
    const attempt = async (forceRefresh: boolean): Promise<Response> => {
      const accessToken = await this.resolveAccessToken(userId, forceRefresh);
      return this.fetchFn(`${GMAIL_API_BASE}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    };

    let res = await attempt(false);
    if (res.status === 401) {
      res = await attempt(true);
    }

    if (res.status === 404 && options?.throwHistoryExpiredOn404) {
      throw new GmailHistoryExpiredError();
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GmailApiError(
        `Gmail API request failed (${res.status}): ${body.slice(0, 200)}`,
        res.status >= 400 && res.status < 500 ? res.status : 502,
      );
    }

    return (await res.json()) as T;
  }

  async getProfile(userId: string): Promise<GmailProfile> {
    const data = await this.gmailRequest<{
      emailAddress?: string;
      historyId?: string;
    }>(userId, "/profile");

    if (!data.emailAddress || !data.historyId) {
      throw new GmailApiError("Gmail profile response missing required fields");
    }

    return {
      emailAddress: data.emailAddress,
      historyId: String(data.historyId),
    };
  }

  async listMessages(
    userId: string,
    params: { query?: string; maxResults?: number; pageToken?: string } = {},
  ): Promise<GmailListMessagesResult> {
    const search = new URLSearchParams();
    if (params.query) search.set("q", params.query);
    if (params.maxResults) search.set("maxResults", String(params.maxResults));
    if (params.pageToken) search.set("pageToken", params.pageToken);

    const qs = search.toString();
    const data = await this.gmailRequest<{
      messages?: Array<{ id: string; threadId?: string }>;
      nextPageToken?: string;
    }>(userId, `/messages${qs ? `?${qs}` : ""}`);

    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      nextPageToken: data.nextPageToken,
    };
  }

  async listHistory(
    userId: string,
    startHistoryId: string,
  ): Promise<GmailHistoryResult> {
    const search = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
    });

    const data = await this.gmailRequest<{
      history?: Array<{
        messagesAdded?: Array<{ message?: { id?: string } }>;
      }>;
      historyId?: string;
    }>(userId, `/history?${search.toString()}`, {
      throwHistoryExpiredOn404: true,
    });

    const ids = new Set<string>();
    if (Array.isArray(data.history)) {
      for (const entry of data.history) {
        if (!Array.isArray(entry.messagesAdded)) continue;
        for (const added of entry.messagesAdded) {
          if (added.message?.id) {
            ids.add(added.message.id);
          }
        }
      }
    }

    return {
      messageIds: [...ids],
      historyId: data.historyId ? String(data.historyId) : undefined,
    };
  }

  async getMessage(
    userId: string,
    messageId: string,
  ): Promise<GmailMessageDetail> {
    const data = await this.gmailRequest<RawGmailMessage>(
      userId,
      `/messages/${encodeURIComponent(messageId)}?format=full`,
    );

    const headers = data.payload?.headers;
    const fromAddress = extractHeader(headers, "From");
    const subject = extractHeader(headers, "Subject");
    const internalMs = data.internalDate ? Number(data.internalDate) : NaN;
    const receivedAt = Number.isFinite(internalMs)
      ? new Date(internalMs)
      : new Date();

    const acc = {
      plainTexts: [] as string[],
      htmlTexts: [] as string[],
      pdfAttachments: [] as GmailAttachmentMeta[],
    };
    traverseMimeParts(data.payload, 0, acc);

    let bodyText = "";
    if (acc.plainTexts.length > 0) {
      bodyText = acc.plainTexts.join("\n\n").trim();
    } else if (acc.htmlTexts.length > 0) {
      bodyText = acc.htmlTexts.map(stripHtmlTags).join("\n\n").trim();
    } else if (data.snippet) {
      bodyText = data.snippet.trim();
    }

    return {
      id: data.id,
      threadId: data.threadId,
      fromAddress,
      subject,
      receivedAt,
      snippet: data.snippet ?? null,
      bodyText,
      pdfAttachments: acc.pdfAttachments,
    };
  }

  async getAttachment(
    userId: string,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const data = await this.gmailRequest<{
      size?: number;
      data?: string;
    }>(
      userId,
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );

    if (
      typeof data.size === "number" &&
      data.size > MAX_PDF_ATTACHMENT_BYTES
    ) {
      throw new GmailApiError(
        `Attachment exceeds ${MAX_PDF_ATTACHMENT_BYTES} byte limit`,
        413,
      );
    }

    if (!data.data) {
      throw new GmailApiError("Gmail attachment response missing data payload");
    }

    const decoded = decodeBase64Url(data.data);
    if (decoded.byteLength > MAX_PDF_ATTACHMENT_BYTES) {
      throw new GmailApiError(
        `Decoded attachment exceeds ${MAX_PDF_ATTACHMENT_BYTES} byte limit`,
        413,
      );
    }

    return decoded;
  }
}
