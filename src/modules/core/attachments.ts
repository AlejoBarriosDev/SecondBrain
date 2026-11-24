import { EntityType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/api/errors";
import { recordAuditLog } from "./audit-logs";

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const createAttachmentSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(128),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(
      MAX_ATTACHMENT_SIZE_BYTES,
      `Attachment cannot exceed ${MAX_ATTACHMENT_SIZE_BYTES} bytes`,
    ),
  storageKey: z.string().trim().min(1).max(512),
  sha256: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{64}$/, "sha256 must be a 64-character hex string")
    .optional(),
});

export type CreateAttachmentInput = z.infer<typeof createAttachmentSchema>;

export async function createAttachment(
  userId: string,
  input: CreateAttachmentInput,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const data = createAttachmentSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const created = await tx.attachment.create({
      data: {
        userId,
        entityType: data.entityType,
        entityId: data.entityId,
        fileName: data.fileName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        storageKey: data.storageKey,
        sha256: data.sha256 ?? null,
      },
    });

    await recordAuditLog(tx, {
      userId,
      action: "ATTACHMENT_CREATED",
      entityType: "ATTACHMENT",
      entityId: created.id,
      after: created,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return created;
  });
}

export async function listAttachments(
  userId: string,
  entityType: EntityType,
  entityId: string,
) {
  return prisma.attachment.findMany({
    where: {
      userId,
      entityType,
      entityId,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteAttachment(
  userId: string,
  attachmentId: string,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.attachment.findFirst({
      where: { id: attachmentId, userId },
    });

    if (!existing) {
      throw new NotFoundError("Attachment not found");
    }

    await tx.attachment.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(tx, {
      userId,
      action: "ATTACHMENT_DELETED",
      entityType: "ATTACHMENT",
      entityId: existing.id,
      before: existing,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { id: existing.id, deleted: true };
  });
}
