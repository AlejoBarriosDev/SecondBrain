import crypto from "node:crypto";
import {
  type EmailImportItem,
  EmailImportStatus,
  EntityType,
  type ParserSource,
  Prisma,
  TransactionStatus,
  TransactionType,
} from "@prisma/client";
import { z } from "zod";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import {
  addDecimals,
  assertDecimal19_4,
  formatDecimal,
  toPositiveDecimal,
} from "@/lib/db/decimal";
import {
  lockEmailImportItem,
  lockFinancialAccounts,
} from "@/lib/db/locks";
import { prisma } from "@/lib/db/prisma";
import { MAX_PDF_ATTACHMENT_BYTES } from "@/lib/integrations/gmail-client";
import { recordAuditLog } from "@/modules/core/audit-logs";
import { HybridParser } from "./hybrid-parser";
import {
  computeBalanceDelta,
  serializeTransaction,
  type SerializedTransaction,
} from "./serializers";
import {
  currencySchema,
  isoDateSchema,
  positiveDecimalStringSchema,
  type RequestMeta,
} from "./types";

const MAX_PDF_BASE64_CHARS = 14_200_000;

export interface SerializedEmailImportItem {
  id: string;
  userId: string;
  emailSyncStateId: string | null;
  externalMessageId: string;
  threadId: string | null;
  fromAddress: string | null;
  subject: string | null;
  receivedAt: string;
  rawSnippet: string | null;
  rawPayloadHash: string | null;
  hasPdfAttachment: boolean;
  parserSource: ParserSource;
  parserNotes: string | null;
  confidence: string | null;
  status: EmailImportStatus;
  parsedType: TransactionType | null;
  parsedAmount: string | null;
  parsedCurrency: string | null;
  parsedMerchant: string | null;
  parsedDescription: string | null;
  parsedDate: string | null;
  suggestedAccountId: string | null;
  suggestedCategoryId: string | null;
  rawExtractedJson: unknown;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeEmailImportItem(
  item: EmailImportItem,
): SerializedEmailImportItem {
  return {
    id: item.id,
    userId: item.userId,
    emailSyncStateId: item.emailSyncStateId,
    externalMessageId: item.externalMessageId,
    threadId: item.threadId,
    fromAddress: item.fromAddress,
    subject: item.subject,
    receivedAt: item.receivedAt.toISOString(),
    rawSnippet: item.rawSnippet,
    rawPayloadHash: item.rawPayloadHash,
    hasPdfAttachment: item.hasPdfAttachment,
    parserSource: item.parserSource,
    parserNotes: item.parserNotes,
    confidence:
      item.confidence != null ? formatDecimal(item.confidence, 4) : null,
    status: item.status,
    parsedType: item.parsedType,
    parsedAmount:
      item.parsedAmount != null ? formatDecimal(item.parsedAmount, 4) : null,
    parsedCurrency: item.parsedCurrency,
    parsedMerchant: item.parsedMerchant,
    parsedDescription: item.parsedDescription,
    parsedDate: item.parsedDate ? item.parsedDate.toISOString() : null,
    suggestedAccountId: item.suggestedAccountId,
    suggestedCategoryId: item.suggestedCategoryId,
    rawExtractedJson: item.rawExtractedJson,
    reviewedAt: item.reviewedAt ? item.reviewedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export const listInboxQuerySchema = z.object({
  status: z.nativeEnum(EmailImportStatus).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const ingestInboxItemSchema = z.object({
  externalMessageId: z.string().trim().min(1).max(255).optional(),
  threadId: z.string().trim().min(1).max(255).nullable().optional(),
  fromAddress: z.string().trim().max(255).nullable().optional(),
  subject: z.string().trim().max(500).nullable().optional(),
  bodyText: z.string().max(100_000).nullable().optional(),
  pdfBase64: z.string().min(1).nullable().optional(),
  pdfFileName: z.string().trim().min(1).max(255).nullable().optional(),
  receivedAt: isoDateSchema.optional(),
});

export const updateInboxItemSchema = z.object({
  parsedType: z.nativeEnum(TransactionType).nullable().optional(),
  parsedAmount: positiveDecimalStringSchema.nullable().optional(),
  parsedCurrency: currencySchema.nullable().optional(),
  parsedMerchant: z.string().trim().max(160).nullable().optional(),
  parsedDescription: z.string().trim().max(255).nullable().optional(),
  parsedDate: isoDateSchema.nullable().optional(),
  suggestedAccountId: z.string().trim().min(1).nullable().optional(),
  suggestedCategoryId: z.string().trim().min(1).nullable().optional(),
  parserNotes: z.string().trim().max(1000).nullable().optional(),
});

export const confirmInboxItemSchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).nullable().optional(),
  type: z.enum([TransactionType.INCOME, TransactionType.EXPENSE]).optional(),
  amount: positiveDecimalStringSchema.optional(),
  currency: currencySchema.optional(),
  occurredAt: isoDateSchema.optional(),
  description: z.string().trim().min(1).max(255).optional(),
  merchant: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const rejectInboxItemSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export type ListInboxQuery = z.input<typeof listInboxQuerySchema>;
export type IngestInboxItemInput = z.input<typeof ingestInboxItemSchema>;
export type UpdateInboxItemInput = z.input<typeof updateInboxItemSchema>;
export type ConfirmInboxItemInput = z.input<typeof confirmInboxItemSchema>;
export type RejectInboxItemInput = z.input<typeof rejectInboxItemSchema>;

export async function listInboxItems(
  userId: string,
  query: Partial<ListInboxQuery> = {},
): Promise<SerializedEmailImportItem[]> {
  const parsed = listInboxQuerySchema.parse(query);
  const items = await prisma.emailImportItem.findMany({
    where: {
      userId,
      ...(parsed.status ? { status: parsed.status } : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: parsed.limit,
  });

  return items.map(serializeEmailImportItem);
}

export async function getInboxItem(
  userId: string,
  itemId: string,
): Promise<SerializedEmailImportItem> {
  const item = await prisma.emailImportItem.findFirst({
    where: { id: itemId, userId },
  });

  if (!item) {
    throw new NotFoundError("Inbox item not found");
  }

  return serializeEmailImportItem(item);
}

/**
 * Ingests raw email text and/or a base64-encoded PDF through HybridParser into
 * EmailImportItem as PENDING. Idempotent on (userId, externalMessageId).
 * Staging invariant (F-FIN-06): NEVER mutates FinancialAccount.balance or Transaction.
 */
export async function ingestInboxItem(
  userId: string,
  rawInput: IngestInboxItemInput,
  deps: { hybridParser?: HybridParser } = {},
): Promise<{ item: SerializedEmailImportItem; created: boolean }> {
  const input = ingestInboxItemSchema.parse(rawInput);

  const externalMessageId =
    input.externalMessageId ?? `manual-${crypto.randomUUID()}`;

  // Check idempotency before parsing
  const existing = await prisma.emailImportItem.findUnique({
    where: {
      userId_externalMessageId: {
        userId,
        externalMessageId,
      },
    },
  });
  if (existing) {
    return { item: serializeEmailImportItem(existing), created: false };
  }

  let pdfBuffer: Buffer | null = null;
  let pdfSha256: string | null = null;
  const pdfFileName = input.pdfFileName ?? "statement.pdf";

  if (input.pdfBase64) {
    // Strip optional data URI prefix if sent
    const cleanedB64 = input.pdfBase64.replace(
      /^data:application\/pdf;base64,/i,
      "",
    );
    if (cleanedB64.length > MAX_PDF_BASE64_CHARS) {
      throw new ValidationError(
        `PDF attachment exceeds maximum allowed size of ${MAX_PDF_ATTACHMENT_BYTES} bytes`,
        { pdfBase64: ["PDF exceeds 10MB limit"] },
      );
    }
    pdfBuffer = Buffer.from(cleanedB64, "base64");
    if (pdfBuffer.byteLength > MAX_PDF_ATTACHMENT_BYTES) {
      throw new ValidationError(
        `PDF attachment exceeds maximum allowed size of ${MAX_PDF_ATTACHMENT_BYTES} bytes`,
        { pdfBase64: ["PDF exceeds 10MB limit"] },
      );
    }
    pdfSha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
  }

  const [settings, activeAccounts] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.financialAccount.findMany({
      where: { userId, isArchived: false },
      select: { id: true, lastFour: true },
    }),
  ]);

  const hybridParser = deps.hybridParser ?? new HybridParser();
  const parsed = await hybridParser.parse({
    fromAddress: input.fromAddress,
    subject: input.subject,
    bodyText: input.bodyText,
    pdfAttachments: pdfBuffer
      ? [{ fileName: pdfFileName, buffer: pdfBuffer }]
      : [],
    defaultCurrency: settings?.defaultCurrency ?? "USD",
    aiParserEnabled: settings?.aiParserEnabled ?? true,
  });

  const suggestedAccountId = parsed.accountLastFour
    ? (activeAccounts.find((a) => a.lastFour === parsed.accountLastFour)?.id ??
      null)
    : null;

  const payloadHash = crypto
    .createHash("sha256")
    .update(
      `${externalMessageId}|${input.subject ?? ""}|${input.bodyText ?? ""}|${pdfSha256 ?? ""}`,
    )
    .digest("hex");

  const receivedAt = input.receivedAt ?? new Date();

  try {
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.emailImportItem.create({
        data: {
          userId,
          externalMessageId,
          threadId: input.threadId ?? null,
          fromAddress: input.fromAddress ?? null,
          subject: input.subject ?? null,
          receivedAt,
          rawSnippet: input.bodyText
            ? input.bodyText.trim().slice(0, 500)
            : (input.subject ?? null),
          rawPayloadHash: payloadHash,
          hasPdfAttachment: Boolean(pdfBuffer),
          parserSource: parsed.parserSource,
          parserNotes: parsed.parserNotes,
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

      if (pdfBuffer) {
        await tx.attachment.create({
          data: {
            userId,
            entityType: EntityType.EMAIL_IMPORT_ITEM,
            entityId: item.id,
            fileName: pdfFileName,
            mimeType: "application/pdf",
            sizeBytes: pdfBuffer.byteLength,
            storageKey: `ingest://${item.id}/${pdfFileName}`,
            sha256: pdfSha256,
          },
        });
      }

      return item;
    });

    return { item: serializeEmailImportItem(created), created: true };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const raced = await prisma.emailImportItem.findUnique({
        where: {
          userId_externalMessageId: {
            userId,
            externalMessageId,
          },
        },
      });
      if (raced) {
        return { item: serializeEmailImportItem(raced), created: false };
      }
    }
    throw err;
  }
}

export async function updateInboxItem(
  userId: string,
  itemId: string,
  rawInput: UpdateInboxItemInput,
  meta?: RequestMeta,
): Promise<SerializedEmailImportItem> {
  const input = updateInboxItemSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    const locked = await lockEmailImportItem(tx, userId, itemId);
    if (locked.status !== EmailImportStatus.PENDING) {
      throw new ConflictError(
        `Cannot edit inbox item in ${locked.status} status`,
      );
    }

    const existing = await tx.emailImportItem.findUniqueOrThrow({
      where: { id: itemId },
    });

    if (input.suggestedAccountId) {
      const acc = await tx.financialAccount.findFirst({
        where: { id: input.suggestedAccountId, userId },
        select: { id: true, isArchived: true },
      });
      if (!acc) {
        throw new NotFoundError("Suggested financial account not found");
      }
      if (acc.isArchived) {
        throw new ValidationError("Cannot assign an archived account", {
          suggestedAccountId: ["Account is archived"],
        });
      }
    }

    if (input.suggestedCategoryId) {
      const cat = await tx.category.findFirst({
        where: { id: input.suggestedCategoryId, userId },
        select: { id: true },
      });
      if (!cat) {
        throw new NotFoundError("Suggested category not found");
      }
    }

    const updated = await tx.emailImportItem.update({
      where: { id: itemId },
      data: {
        ...(input.parsedType !== undefined
          ? { parsedType: input.parsedType }
          : {}),
        ...(input.parsedAmount !== undefined
          ? {
              parsedAmount:
                input.parsedAmount !== null
                  ? toPositiveDecimal(input.parsedAmount)
                  : null,
            }
          : {}),
        ...(input.parsedCurrency !== undefined
          ? { parsedCurrency: input.parsedCurrency }
          : {}),
        ...(input.parsedMerchant !== undefined
          ? { parsedMerchant: input.parsedMerchant }
          : {}),
        ...(input.parsedDescription !== undefined
          ? { parsedDescription: input.parsedDescription }
          : {}),
        ...(input.parsedDate !== undefined
          ? { parsedDate: input.parsedDate }
          : {}),
        ...(input.suggestedAccountId !== undefined
          ? { suggestedAccountId: input.suggestedAccountId }
          : {}),
        ...(input.suggestedCategoryId !== undefined
          ? { suggestedCategoryId: input.suggestedCategoryId }
          : {}),
        ...(input.parserNotes !== undefined
          ? { parserNotes: input.parserNotes }
          : {}),
      },
    });

    const serializedBefore = serializeEmailImportItem(existing);
    const serializedAfter = serializeEmailImportItem(updated);

    await recordAuditLog(tx, {
      userId,
      action: "INBOX_ITEM_UPDATED",
      entityType: "EMAIL_IMPORT_ITEM",
      entityId: updated.id,
      before: serializedBefore,
      after: serializedAfter,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return serializedAfter;
  });
}

/**
 * Atomically confirms a PENDING EmailImportItem into a POSTED Transaction,
 * updates FinancialAccount.balance under FOR UPDATE locks (DAG: email_import_items -> financial_accounts),
 * and writes an INBOX_ITEM_CONFIRMED AuditLog.
 * Returns 409 CONFLICT if already CONFIRMED or REJECTED.
 */
export async function confirmInboxItem(
  userId: string,
  itemId: string,
  rawInput: ConfirmInboxItemInput = {},
  meta?: RequestMeta,
): Promise<{
  item: SerializedEmailImportItem;
  transaction: SerializedTransaction;
}> {
  const input = confirmInboxItemSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    // 1. Lock EmailImportItem row FOR UPDATE (first in lock DAG)
    const locked = await lockEmailImportItem(tx, userId, itemId);
    if (locked.status !== EmailImportStatus.PENDING) {
      throw new ConflictError(
        `Inbox item is already ${locked.status} and cannot be confirmed`,
      );
    }

    const item = await tx.emailImportItem.findUniqueOrThrow({
      where: { id: itemId },
    });

    // 2. Resolve fields from explicit overrides or staged parsed/suggested values
    const accountId = input.accountId ?? item.suggestedAccountId;
    if (!accountId) {
      throw new ValidationError("accountId is required to confirm an inbox item", {
        accountId: ["accountId is required"],
      });
    }

    const resolvedType = input.type ?? item.parsedType;
    if (
      resolvedType !== TransactionType.INCOME &&
      resolvedType !== TransactionType.EXPENSE
    ) {
      throw new ValidationError(
        "Transaction type must be INCOME or EXPENSE to confirm an inbox item",
        { type: ["Type must be INCOME or EXPENSE"] },
      );
    }

    const resolvedAmountStr =
      input.amount ??
      (item.parsedAmount != null ? formatDecimal(item.parsedAmount) : undefined);
    if (!resolvedAmountStr) {
      throw new ValidationError("amount is required to confirm an inbox item", {
        amount: ["amount is required"],
      });
    }
    const validatedAmountStr =
      positiveDecimalStringSchema.parse(resolvedAmountStr);
    const amountDec = toPositiveDecimal(validatedAmountStr);

    const description = (
      input.description ??
      item.parsedDescription ??
      item.parsedMerchant ??
      item.subject ??
      "Imported transaction"
    )
      .trim()
      .slice(0, 255);
    if (!description) {
      throw new ValidationError("description is required", {
        description: ["description is required"],
      });
    }

    const merchant =
      input.merchant !== undefined ? input.merchant : item.parsedMerchant;
    const categoryId =
      input.categoryId !== undefined
        ? input.categoryId
        : item.suggestedCategoryId;
    const occurredAt =
      input.occurredAt ?? item.parsedDate ?? item.receivedAt ?? new Date();

    // 3. Lock target FinancialAccount FOR UPDATE (second in lock DAG)
    const lockedAccounts = await lockFinancialAccounts(tx, userId, [accountId]);
    const account = lockedAccounts.get(accountId)!;
    if (account.isArchived) {
      throw new ValidationError(
        "Cannot confirm transaction into an archived financial account",
      );
    }

    const currency = (
      input.currency ??
      item.parsedCurrency ??
      account.currency
    ).toUpperCase();

    if (currency !== account.currency) {
      throw new ValidationError(
        "Transaction currency must match target account currency",
        {
          currency: [
            `Transaction currency (${currency}) must match account currency (${account.currency})`,
          ],
        },
      );
    }

    if (categoryId) {
      const cat = await tx.category.findFirst({
        where: { id: categoryId, userId },
        select: { id: true },
      });
      if (!cat) {
        throw new NotFoundError("Category not found");
      }
    }

    // 4. Create POSTED Transaction linked 1:1 via emailImportItemId
    const createdTx = await tx.transaction.create({
      data: {
        userId,
        accountId,
        categoryId: categoryId ?? null,
        type: resolvedType,
        amount: amountDec,
        currency,
        occurredAt,
        description,
        merchant: merchant ?? null,
        notes: input.notes ?? null,
        status: TransactionStatus.POSTED,
        emailImportItemId: item.id,
      },
      include: {
        account: {
          select: { id: true, name: true, type: true, currency: true },
        },
        category: {
          select: { id: true, name: true, type: true, icon: true, color: true },
        },
      },
    });

    // 5. Apply exact Decimal(19,4) balance delta
    const delta = computeBalanceDelta(
      resolvedType,
      TransactionStatus.POSTED,
      amountDec,
    );
    const nextBalance = assertDecimal19_4(
      addDecimals(account.balance, delta),
      "amount",
      "Resulting account balance exceeds Decimal(19,4) bounds",
    );

    await tx.financialAccount.update({
      where: { id: accountId },
      data: { balance: nextBalance },
    });

    // 6. Transition EmailImportItem to CONFIRMED
    const updatedItem = await tx.emailImportItem.update({
      where: { id: item.id },
      data: {
        status: EmailImportStatus.CONFIRMED,
        reviewedAt: new Date(),
        suggestedAccountId: accountId,
        suggestedCategoryId: categoryId ?? null,
        parsedType: resolvedType,
        parsedAmount: amountDec,
        parsedCurrency: currency,
        parsedMerchant: merchant ?? null,
        parsedDescription: description,
        parsedDate: occurredAt,
      },
    });

    const serializedBefore = serializeEmailImportItem(item);
    const serializedAfter = serializeEmailImportItem(updatedItem);
    const serializedTx = serializeTransaction(createdTx);

    // 7. Record AuditLog
    await recordAuditLog(tx, {
      userId,
      action: "INBOX_ITEM_CONFIRMED",
      entityType: "EMAIL_IMPORT_ITEM",
      entityId: item.id,
      before: serializedBefore,
      after: {
        item: serializedAfter,
        transactionId: createdTx.id,
        accountId,
        newAccountBalance: formatDecimal(nextBalance),
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      item: serializedAfter,
      transaction: serializedTx,
    };
  });
}

/**
 * Atomically rejects/dismisses a PENDING EmailImportItem with FOR UPDATE guard,
 * AuditLog, and zero FinancialAccount/Transaction side effects.
 */
export async function rejectInboxItem(
  userId: string,
  itemId: string,
  rawInput: RejectInboxItemInput = {},
  meta?: RequestMeta,
): Promise<SerializedEmailImportItem> {
  const input = rejectInboxItemSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    const locked = await lockEmailImportItem(tx, userId, itemId);
    if (locked.status !== EmailImportStatus.PENDING) {
      throw new ConflictError(
        `Inbox item is already ${locked.status} and cannot be rejected`,
      );
    }

    const item = await tx.emailImportItem.findUniqueOrThrow({
      where: { id: itemId },
    });

    const updatedItem = await tx.emailImportItem.update({
      where: { id: item.id },
      data: {
        status: EmailImportStatus.REJECTED,
        reviewedAt: new Date(),
        ...(input.reason
          ? {
              parserNotes: item.parserNotes
                ? `${item.parserNotes} | Rejected: ${input.reason}`
                : `Rejected: ${input.reason}`,
            }
          : {}),
      },
    });

    const serializedBefore = serializeEmailImportItem(item);
    const serializedAfter = serializeEmailImportItem(updatedItem);

    await recordAuditLog(tx, {
      userId,
      action: "INBOX_ITEM_REJECTED",
      entityType: "EMAIL_IMPORT_ITEM",
      entityId: item.id,
      before: serializedBefore,
      after: serializedAfter,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return serializedAfter;
  });
}
