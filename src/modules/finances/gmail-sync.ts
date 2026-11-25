import crypto from "node:crypto";
import {
  EmailImportStatus,
  type EmailSyncState,
  EmailSyncStatus,
  EntityType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { ConflictError } from "@/lib/api/errors";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import {
  GmailHistoryExpiredError,
  GmailRestClient,
  type IGmailClient,
  MAX_PDF_ATTACHMENT_BYTES,
} from "@/lib/integrations/gmail-client";
import { HybridParser } from "./hybrid-parser";

const SYNC_LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_MESSAGES_PER_SYNC = 25;
const DEFAULT_GMAIL_QUERY =
  "(bank OR banco OR purchase OR compra OR card OR tarjeta OR transfer OR transferencia OR deposit OR statement OR extracto OR invoice OR factura OR payment OR pago) newer_than:30d";

export interface SerializedEmailSyncState {
  id: string;
  userId: string;
  provider: string;
  emailAddress: string;
  historyId: string | null;
  lastSyncedAt: string | null;
  status: EmailSyncStatus;
  lastError: string | null;
  queryFilter: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GmailSyncOptions {
  maxResults?: number;
  query?: string;
  fullResync?: boolean;
}

export interface GmailSyncResult {
  synced: number;
  skipped: number;
  errors: string[];
  state: SerializedEmailSyncState;
}

export interface GmailSyncServiceDeps {
  prisma?: PrismaClient;
  gmailClient?: IGmailClient;
  hybridParser?: HybridParser;
  maxMessagesPerSync?: number;
}

export function serializeEmailSyncState(
  state: EmailSyncState,
): SerializedEmailSyncState {
  return {
    id: state.id,
    userId: state.userId,
    provider: state.provider,
    emailAddress: state.emailAddress,
    historyId: state.historyId,
    lastSyncedAt: state.lastSyncedAt ? state.lastSyncedAt.toISOString() : null,
    status: state.status,
    lastError: state.lastError,
    queryFilter: state.queryFilter,
    enabled: state.enabled,
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
  };
}

function sha256Hex(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class GmailSyncService {
  private readonly prisma: PrismaClient;
  private readonly gmailClient: IGmailClient;
  private readonly hybridParser: HybridParser;
  private readonly maxMessagesPerSync: number;

  constructor(deps: GmailSyncServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma;
    this.gmailClient = deps.gmailClient ?? new GmailRestClient();
    this.hybridParser = deps.hybridParser ?? new HybridParser();
    this.maxMessagesPerSync =
      deps.maxMessagesPerSync ?? DEFAULT_MAX_MESSAGES_PER_SYNC;
  }

  /**
   * Synchronizes Gmail messages into EmailImportItem staging records.
   * Staging invariant (F-FIN-06): NEVER mutates FinancialAccount.balance or creates Transaction rows.
   */
  async syncUser(
    userId: string,
    options: GmailSyncOptions = {},
  ): Promise<GmailSyncResult> {
    // 1. Verify Gmail OAuth connectivity & scope before acquiring DB sync lock
    const profile = await this.gmailClient.getProfile(userId);

    // 2. Ensure EmailSyncState exists for this (userId, provider, emailAddress)
    const state = await this.prisma.emailSyncState.upsert({
      where: {
        userId_provider_emailAddress: {
          userId,
          provider: "gmail",
          emailAddress: profile.emailAddress,
        },
      },
      create: {
        userId,
        provider: "gmail",
        emailAddress: profile.emailAddress,
        status: EmailSyncStatus.IDLE,
        enabled: true,
      },
      update: {},
    });

    // 3. Acquire atomic concurrency lock on EmailSyncState
    const staleCutoff = new Date(Date.now() - SYNC_LOCK_STALE_MS);
    const acquired = await this.prisma.emailSyncState.updateMany({
      where: {
        id: state.id,
        OR: [
          { status: { not: EmailSyncStatus.SYNCING } },
          { updatedAt: { lt: staleCutoff } },
        ],
      },
      data: {
        status: EmailSyncStatus.SYNCING,
        lastError: null,
      },
    });

    if (acquired.count === 0) {
      throw new ConflictError(
        "A Gmail sync is already in progress for this account.",
      );
    }

    const errors: string[] = [];
    let synced = 0;
    let skipped = 0;
    let nextHistoryId = profile.historyId;

    try {
      const [settings, activeAccounts] = await Promise.all([
        this.prisma.userSettings.findUnique({ where: { userId } }),
        this.prisma.financialAccount.findMany({
          where: { userId, isArchived: false },
          select: { id: true, lastFour: true },
        }),
      ]);

      const query =
        options.query ?? state.queryFilter ?? DEFAULT_GMAIL_QUERY;
      const maxResults = options.maxResults ?? this.maxMessagesPerSync;

      // 4. Fetch candidate message IDs via incremental historyId or fallback full list
      let candidateIds: string[] = [];
      let usedIncremental = false;

      if (!options.fullResync && state.historyId) {
        try {
          const historyRes = await this.gmailClient.listHistory(
            userId,
            state.historyId,
          );
          candidateIds = historyRes.messageIds;
          if (historyRes.historyId) {
            nextHistoryId = historyRes.historyId;
          }
          usedIncremental = true;
        } catch (err) {
          if (err instanceof GmailHistoryExpiredError) {
            // HTTP 404 expired historyId -> fall back cleanly to full recent listing
            usedIncremental = false;
          } else {
            throw err;
          }
        }
      }

      if (!usedIncremental) {
        const listRes = await this.gmailClient.listMessages(userId, {
          query,
          maxResults,
        });
        candidateIds = listRes.messages.map((m) => m.id);
      }

      const uniqueIds = [...new Set(candidateIds)].slice(0, maxResults);

      // 5. Deduplicate against already-imported externalMessageIds before fetching full messages
      const existingRows =
        uniqueIds.length > 0
          ? await this.prisma.emailImportItem.findMany({
              where: {
                userId,
                externalMessageId: { in: uniqueIds },
              },
              select: { externalMessageId: true },
            })
          : [];

      const existingSet = new Set(existingRows.map((r) => r.externalMessageId));
      const newIds = uniqueIds.filter((id) => !existingSet.has(id));
      skipped += uniqueIds.length - newIds.length;

      // 6. Fetch, parse, and stage each new message as PENDING EmailImportItem
      for (const messageId of newIds) {
        try {
          const msg = await this.gmailClient.getMessage(userId, messageId);
          const extraNotes: string[] = [];
          const downloadedPdfs: Array<{
            attachmentId: string;
            fileName: string;
            mimeType: string;
            buffer: Buffer;
            sha256: string;
          }> = [];

          for (const pdfMeta of msg.pdfAttachments) {
            if (pdfMeta.sizeBytes > MAX_PDF_ATTACHMENT_BYTES) {
              extraNotes.push(
                `Skipped PDF "${pdfMeta.fileName}": exceeds 10MB cap (${pdfMeta.sizeBytes} bytes).`,
              );
              continue;
            }
            try {
              const buffer = await this.gmailClient.getAttachment(
                userId,
                messageId,
                pdfMeta.attachmentId,
              );
              if (buffer.byteLength > MAX_PDF_ATTACHMENT_BYTES) {
                extraNotes.push(
                  `Skipped PDF "${pdfMeta.fileName}": decoded buffer exceeds 10MB cap.`,
                );
                continue;
              }
              downloadedPdfs.push({
                attachmentId: pdfMeta.attachmentId,
                fileName: pdfMeta.fileName,
                mimeType: pdfMeta.mimeType,
                buffer,
                sha256: sha256Hex(buffer),
              });
            } catch (attErr) {
              extraNotes.push(
                `Failed to download PDF "${pdfMeta.fileName}": ${attErr instanceof Error ? attErr.message : "unknown error"}`,
              );
            }
          }

          const parsed = await this.hybridParser.parse({
            fromAddress: msg.fromAddress,
            subject: msg.subject,
            bodyText: msg.bodyText,
            pdfAttachments: downloadedPdfs.map((p) => ({
              fileName: p.fileName,
              buffer: p.buffer,
            })),
            defaultCurrency: settings?.defaultCurrency ?? "USD",
            aiParserEnabled: settings?.aiParserEnabled ?? true,
          });

          const suggestedAccountId = parsed.accountLastFour
            ? (activeAccounts.find((a) => a.lastFour === parsed.accountLastFour)
                ?.id ?? null)
            : null;

          const combinedNotes = [parsed.parserNotes, ...extraNotes]
            .filter(Boolean)
            .join(" | ");

          const payloadHash = sha256Hex(
            `${msg.id}|${msg.subject ?? ""}|${msg.bodyText}|${downloadedPdfs.map((p) => p.sha256).join(",")}`,
          );

          try {
            const createdItem = await this.prisma.emailImportItem.create({
              data: {
                userId,
                emailSyncStateId: state.id,
                externalMessageId: msg.id,
                threadId: msg.threadId ?? null,
                fromAddress: msg.fromAddress,
                subject: msg.subject,
                receivedAt: msg.receivedAt,
                rawSnippet: (msg.snippet ?? msg.bodyText).slice(0, 500) || null,
                rawPayloadHash: payloadHash,
                hasPdfAttachment: msg.pdfAttachments.length > 0,
                parserSource: parsed.parserSource,
                parserNotes: combinedNotes || null,
                confidence: new Prisma.Decimal(parsed.confidence),
                status: EmailImportStatus.PENDING,
                parsedType: parsed.parsedType,
                parsedAmount: parsed.parsedAmount
                  ? new Prisma.Decimal(parsed.parsedAmount)
                  : null,
                parsedCurrency: parsed.parsedCurrency,
                parsedMerchant: parsed.parsedMerchant,
                parsedDescription: parsed.parsedDescription,
                parsedDate: parsed.parsedDate,
                suggestedAccountId,
                rawExtractedJson: parsed.rawExtractedJson,
              },
            });

            if (downloadedPdfs.length > 0) {
              await this.prisma.attachment.createMany({
                data: downloadedPdfs.map((pdf) => ({
                  userId,
                  entityType: EntityType.EMAIL_IMPORT_ITEM,
                  entityId: createdItem.id,
                  fileName: pdf.fileName,
                  mimeType: pdf.mimeType,
                  sizeBytes: pdf.buffer.byteLength,
                  storageKey: `gmail://${msg.id}/${pdf.attachmentId}`,
                  sha256: pdf.sha256,
                })),
              });
            }

            synced += 1;
          } catch (createErr) {
            if (
              createErr instanceof Prisma.PrismaClientKnownRequestError &&
              createErr.code === "P2002"
            ) {
              // Concurrent race on (userId, externalMessageId) -> idempotently skip
              skipped += 1;
            } else {
              throw createErr;
            }
          }
        } catch (msgErr) {
          errors.push(
            `Message ${messageId}: ${msgErr instanceof Error ? msgErr.message : "sync error"}`,
          );
        }
      }

      // 7. Release lock and update sync cursor
      const updatedState = await this.prisma.emailSyncState.update({
        where: { id: state.id },
        data: {
          status: EmailSyncStatus.IDLE,
          historyId: nextHistoryId,
          lastSyncedAt: new Date(),
          lastError: errors.length > 0 ? errors.join("; ").slice(0, 1000) : null,
        },
      });

      return {
        synced,
        skipped,
        errors,
        state: serializeEmailSyncState(updatedState),
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Gmail sync failed";
      await this.prisma.emailSyncState
        .update({
          where: { id: state.id },
          data: {
            status: EmailSyncStatus.ERROR,
            lastError: errorMessage.slice(0, 1000),
          },
        })
        .catch(() => undefined);
      throw err;
    }
  }
}
