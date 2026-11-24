import { EntityType, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/api/errors";
import { recordAuditLog } from "./audit-logs";

export const createEntityLinkSchema = z
  .object({
    sourceType: z.nativeEnum(EntityType),
    sourceId: z.string().trim().min(1),
    targetType: z.nativeEnum(EntityType),
    targetId: z.string().trim().min(1),
    relationType: z.string().trim().min(1).max(64),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) =>
      !(data.sourceType === data.targetType && data.sourceId === data.targetId),
    {
      message: "An entity cannot be linked to itself",
      path: ["targetId"],
    },
  );

export type CreateEntityLinkInput = z.infer<typeof createEntityLinkSchema>;

export async function listEntityLinks(
  userId: string,
  filter?: {
    entityType?: EntityType;
    entityId?: string;
    sourceType?: EntityType;
    sourceId?: string;
  },
) {
  if (filter?.entityType && filter?.entityId) {
    return prisma.entityLink.findMany({
      where: {
        userId,
        OR: [
          { sourceType: filter.entityType, sourceId: filter.entityId },
          { targetType: filter.entityType, targetId: filter.entityId },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  return prisma.entityLink.findMany({
    where: {
      userId,
      ...(filter?.sourceType ? { sourceType: filter.sourceType } : {}),
      ...(filter?.sourceId ? { sourceId: filter.sourceId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createEntityLink(
  userId: string,
  input: CreateEntityLinkInput,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const data = createEntityLinkSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const metadataJson =
      data.metadata !== undefined
        ? (JSON.parse(JSON.stringify(data.metadata)) as Prisma.InputJsonValue)
        : undefined;

    const created = await tx.entityLink.create({
      data: {
        userId,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        targetType: data.targetType,
        targetId: data.targetId,
        relationType: data.relationType,
        ...(metadataJson !== undefined ? { metadata: metadataJson } : {}),
      },
    });

    await recordAuditLog(tx, {
      userId,
      action: "ENTITY_LINK_CREATED",
      entityType: "ENTITY_LINK",
      entityId: created.id,
      after: created,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return created;
  });
}

export async function deleteEntityLink(
  userId: string,
  linkId: string,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.entityLink.findFirst({
      where: { id: linkId, userId },
    });

    if (!existing) {
      throw new NotFoundError("Entity link not found");
    }

    await tx.entityLink.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(tx, {
      userId,
      action: "ENTITY_LINK_DELETED",
      entityType: "ENTITY_LINK",
      entityId: existing.id,
      before: existing,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { id: existing.id, deleted: true };
  });
}
