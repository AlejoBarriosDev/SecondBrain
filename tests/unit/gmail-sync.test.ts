import { describe, expect, it, vi } from "vitest";
import { EmailSyncStatus, type PrismaClient } from "@prisma/client";
import { ConflictError } from "@/lib/api/errors";
import {
  GMAIL_READONLY_SCOPE,
  GmailHistoryExpiredError,
  GmailNotConnectedError,
  GmailRestClient,
  GmailScopeMissingError,
  MAX_PDF_ATTACHMENT_BYTES,
  type IGmailClient,
} from "@/lib/integrations/gmail-client";
import { GmailSyncService } from "@/modules/finances/gmail-sync";

function encodeBase64Url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("GmailRestClient (GMAIL-01, GMAIL-03)", () => {
  it("throws GmailNotConnectedError (412) when user has no Google account", async () => {
    const prismaMock = {
      account: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const client = new GmailRestClient({
      prisma: prismaMock as unknown as Pick<PrismaClient, "account">,
    });

    await expect(client.resolveAccessToken("user-1")).rejects.toThrow(
      GmailNotConnectedError,
    );
  });

  it("throws GmailScopeMissingError (403) when gmail.readonly scope is missing", async () => {
    const prismaMock = {
      account: {
        findFirst: vi.fn().mockResolvedValue({
          id: "acc-1",
          userId: "user-1",
          providerId: "google",
          scope: "openid email profile",
          accessToken: "valid-token",
          accessTokenExpiresAt: new Date(Date.now() + 3600_000),
          refreshToken: "refresh-1",
        }),
        update: vi.fn(),
      },
    };
    const client = new GmailRestClient({
      prisma: prismaMock as unknown as Pick<PrismaClient, "account">,
    });

    await expect(client.resolveAccessToken("user-1")).rejects.toThrow(
      GmailScopeMissingError,
    );
  });

  it("refreshes expired access token via Google OAuth and persists rotated tokens to Account", async () => {
    const updateMock = vi.fn().mockResolvedValue({});
    const prismaMock = {
      account: {
        findFirst: vi.fn().mockResolvedValue({
          id: "acc-1",
          userId: "user-1",
          providerId: "google",
          scope: `openid email ${GMAIL_READONLY_SCOPE}`,
          accessToken: "expired-token",
          accessTokenExpiresAt: new Date(Date.now() - 10_000),
          refreshToken: "refresh-old",
        }),
        update: updateMock,
      },
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "fresh-access-token",
          expires_in: 3600,
          refresh_token: "refresh-rotated",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const client = new GmailRestClient({
      prisma: prismaMock as unknown as Pick<PrismaClient, "account">,
      fetchFn: fetchSpy as unknown as typeof fetch,
      clientId: "google-cid",
      clientSecret: "google-csec",
    });

    const token = await client.resolveAccessToken("user-1");
    expect(token).toBe("fresh-access-token");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acc-1" },
        data: expect.objectContaining({
          accessToken: "fresh-access-token",
          refreshToken: "refresh-rotated",
        }),
      }),
    );
  });

  it("traverses nested MIME parts, decodes URL-safe base64, extracts PDF metadata, and throws GmailHistoryExpiredError on 404", async () => {
    const prismaMock = {
      account: {
        findFirst: vi.fn().mockResolvedValue({
          id: "acc-1",
          userId: "user-1",
          providerId: "google",
          scope: GMAIL_READONLY_SCOPE,
          accessToken: "valid-token",
          accessTokenExpiresAt: new Date(Date.now() + 3600_000),
          refreshToken: "refresh-1",
        }),
        update: vi.fn(),
      },
    };

    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/history?")) {
        return new Response("Not Found", { status: 404 });
      }
      if (url.includes("/messages/msg-1?format=full")) {
        return new Response(
          JSON.stringify({
            id: "msg-1",
            threadId: "thr-1",
            snippet: "Purchase alert",
            internalDate: String(Date.parse("2026-11-20T15:00:00.000Z")),
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "From", value: "alerts@bank.test" },
                { name: "Subject", value: "Card charge USD 110.00" },
              ],
              parts: [
                {
                  mimeType: "multipart/alternative",
                  parts: [
                    {
                      mimeType: "text/plain",
                      body: {
                        data: encodeBase64Url(
                          "Card charge USD 110.00 at Metro Airlines",
                        ),
                      },
                    },
                    {
                      mimeType: "text/html",
                      body: {
                        data: encodeBase64Url("<p>HTML fallback</p>"),
                      },
                    },
                  ],
                },
                {
                  mimeType: "application/pdf",
                  filename: "statement.pdf",
                  body: {
                    attachmentId: "att-1",
                    size: 512,
                  },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/attachments/att-huge")) {
        return new Response(
          JSON.stringify({
            size: MAX_PDF_ATTACHMENT_BYTES + 1,
            data: encodeBase64Url("x"),
          }),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

    const client = new GmailRestClient({
      prisma: prismaMock as unknown as Pick<PrismaClient, "account">,
      fetchFn: fetchSpy as unknown as typeof fetch,
    });

    await expect(client.listHistory("user-1", "1000")).rejects.toThrow(
      GmailHistoryExpiredError,
    );

    const msg = await client.getMessage("user-1", "msg-1");
    expect(msg.fromAddress).toBe("alerts@bank.test");
    expect(msg.subject).toBe("Card charge USD 110.00");
    expect(msg.bodyText).toBe("Card charge USD 110.00 at Metro Airlines");
    expect(msg.pdfAttachments).toEqual([
      {
        attachmentId: "att-1",
        fileName: "statement.pdf",
        mimeType: "application/pdf",
        sizeBytes: 512,
      },
    ]);

    await expect(
      client.getAttachment("user-1", "msg-1", "att-huge"),
    ).rejects.toThrow(/exceeds/i);
  });
});

describe("GmailSyncService (GMAIL-02, GMAIL-03, F-FIN-06)", () => {
  function createMockPrisma(overrides?: {
    existingHistoryId?: string | null;
    lockAcquired?: number;
    existingExternalIds?: string[];
  }) {
    const now = new Date("2026-11-20T12:00:00.000Z");
    const createdItems: Array<Record<string, unknown>> = [];
    const createdAttachments: Array<Record<string, unknown>> = [];
    const financialAccountUpdate = vi.fn();
    const transactionCreate = vi.fn();

    const prismaMock = {
      emailSyncState: {
        upsert: vi.fn().mockResolvedValue({
          id: "sync-state-1",
          userId: "user-1",
          provider: "gmail",
          emailAddress: "owner@secondbrain.local",
          historyId: overrides?.existingHistoryId ?? null,
          lastSyncedAt: null,
          status: EmailSyncStatus.IDLE,
          lastError: null,
          queryFilter: null,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        }),
        updateMany: vi.fn().mockResolvedValue({
          count: overrides?.lockAcquired ?? 1,
        }),
        update: vi.fn().mockImplementation(async ({ data }) => ({
          id: "sync-state-1",
          userId: "user-1",
          provider: "gmail",
          emailAddress: "owner@secondbrain.local",
          historyId: data.historyId ?? overrides?.existingHistoryId ?? "999",
          lastSyncedAt: data.lastSyncedAt ?? now,
          status: data.status ?? EmailSyncStatus.IDLE,
          lastError: data.lastError ?? null,
          queryFilter: null,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        })),
      },
      userSettings: {
        findUnique: vi.fn().mockResolvedValue({
          defaultCurrency: "USD",
          aiParserEnabled: false,
        }),
      },
      financialAccount: {
        findMany: vi.fn().mockResolvedValue([]),
        update: financialAccountUpdate,
      },
      transaction: {
        create: transactionCreate,
      },
      emailImportItem: {
        findMany: vi.fn().mockResolvedValue(
          (overrides?.existingExternalIds ?? []).map((id) => ({
            externalMessageId: id,
          })),
        ),
        create: vi.fn().mockImplementation(async ({ data }) => {
          const item = { id: `item-${createdItems.length + 1}`, ...data };
          createdItems.push(item);
          return item;
        }),
      },
      attachment: {
        createMany: vi.fn().mockImplementation(async ({ data }) => {
          createdAttachments.push(...data);
          return { count: data.length };
        }),
      },
    };

    return {
      prismaMock: prismaMock as unknown as PrismaClient,
      createdItems,
      createdAttachments,
      financialAccountUpdate,
      transactionCreate,
    };
  }

  it("performs incremental historyId sync, deduplicates existing messages, and preserves staging isolation", async () => {
    const {
      prismaMock,
      createdItems,
      financialAccountUpdate,
      transactionCreate,
    } = createMockPrisma({
      existingHistoryId: "500",
      existingExternalIds: ["msg-already-imported"],
    });

    const gmailMock: IGmailClient = {
      getProfile: vi.fn().mockResolvedValue({
        emailAddress: "owner@secondbrain.local",
        historyId: "550",
      }),
      listHistory: vi.fn().mockResolvedValue({
        messageIds: ["msg-already-imported", "msg-new-1"],
        historyId: "560",
      }),
      listMessages: vi.fn(),
      getMessage: vi.fn().mockResolvedValue({
        id: "msg-new-1",
        threadId: "thr-1",
        fromAddress: "alerts@bank.test",
        subject: "Purchase alert: USD 45.50 at Whole Foods",
        receivedAt: new Date("2026-11-20T12:00:00.000Z"),
        snippet: "Purchase alert",
        bodyText: "You made a debit card purchase of $45.50 USD at Whole Foods Market on 2026-11-20.",
        pdfAttachments: [],
      }),
      getAttachment: vi.fn(),
    };

    const service = new GmailSyncService({
      prisma: prismaMock,
      gmailClient: gmailMock,
    });

    const result = await service.syncUser("user-1");

    expect(gmailMock.listHistory).toHaveBeenCalledWith("user-1", "500");
    expect(gmailMock.listMessages).not.toHaveBeenCalled();
    expect(result.synced).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.state.historyId).toBe("560");
    expect(createdItems).toHaveLength(1);
    // Staging isolation (F-FIN-06)
    expect(financialAccountUpdate).not.toHaveBeenCalled();
    expect(transactionCreate).not.toHaveBeenCalled();
  });

  it("falls back cleanly to listMessages when listHistory throws GmailHistoryExpiredError (HTTP 404)", async () => {
    const { prismaMock, createdItems } = createMockPrisma({
      existingHistoryId: "100",
    });

    const gmailMock: IGmailClient = {
      getProfile: vi.fn().mockResolvedValue({
        emailAddress: "owner@secondbrain.local",
        historyId: "900",
      }),
      listHistory: vi
        .fn()
        .mockRejectedValue(new GmailHistoryExpiredError()),
      listMessages: vi.fn().mockResolvedValue({
        messages: [{ id: "msg-fallback-1" }],
      }),
      getMessage: vi.fn().mockResolvedValue({
        id: "msg-fallback-1",
        fromAddress: "banco@test.com",
        subject: "Compra aprobada",
        receivedAt: new Date("2026-11-20T12:00:00.000Z"),
        snippet: "Compra aprobada",
        bodyText: "Compra aprobada por USD 64.25 en Cafe Central",
        pdfAttachments: [],
      }),
      getAttachment: vi.fn(),
    };

    const service = new GmailSyncService({
      prisma: prismaMock,
      gmailClient: gmailMock,
    });

    const result = await service.syncUser("user-1");

    expect(gmailMock.listHistory).toHaveBeenCalledWith("user-1", "100");
    expect(gmailMock.listMessages).toHaveBeenCalledOnce();
    expect(result.synced).toBe(1);
    expect(result.state.historyId).toBe("900");
    expect(createdItems).toHaveLength(1);
  });

  it("throws ConflictError (409) when EmailSyncState concurrency lock is already held", async () => {
    const { prismaMock } = createMockPrisma({ lockAcquired: 0 });

    const gmailMock: IGmailClient = {
      getProfile: vi.fn().mockResolvedValue({
        emailAddress: "owner@secondbrain.local",
        historyId: "900",
      }),
      listHistory: vi.fn(),
      listMessages: vi.fn(),
      getMessage: vi.fn(),
      getAttachment: vi.fn(),
    };

    const service = new GmailSyncService({
      prisma: prismaMock,
      gmailClient: gmailMock,
    });

    await expect(service.syncUser("user-1")).rejects.toThrow(ConflictError);
    expect(gmailMock.listMessages).not.toHaveBeenCalled();
  });
});
