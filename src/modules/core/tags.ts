import { EntityType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { NotFoundError } from "@/lib/api/errors";
import { recordAuditLog } from "./audit-logs";

export const createTagSchema = z.object({
  name: z.string().trim().min(1, "Tag name is required").max(48),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex code")
    .default("#6366f1"),
});

export const entityTagSchema = z.object({
  tagId: z.string().trim().min(1),
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().trim().min(1),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type EntityTagInput = z.infer<typeof entityTagSchema>;

export async function listTags(
  userId: string,
  filter?: { entityType?: EntityType; entityId?: string },
) {
  if (filter?.entityType && filter?.entityId) {
    const entityTags = await prisma.entityTag.findMany({
      where: {
        userId,
        entityType: filter.entityType,
        entityId: filter.entityId,
      },
      include: {
        tag: true,
      },
      orderBy: {
        tag: { name: "asc" },
      },
    });
    return entityTags.map((et) => et.tag);
  }

  return prisma.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
}

export async function createTag(
  userId: string,
  input: CreateTagInput,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const data = createTagSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const created = await tx.tag.create({
      data: {
        userId,
        name: data.name,
        color: data.color,
      },
    });

    await recordAuditLog(tx, {
      userId,
      action: "TAG_CREATED",
      entityType: "TAG",
      entityId: created.id,
      after: created,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return created;
  });
}

export async function deleteTag(
  userId: string,
  tagId: string,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.tag.findFirst({
      where: { id: tagId, userId },
    });

    if (!existing) {
      throw new NotFoundError("Tag not found");
    }

    await tx.tag.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(tx, {
      userId,
      action: "TAG_DELETED",
      entityType: "TAG",
      entityId: existing.id,
      before: existing,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { id: existing.id, deleted: true };
  });
}

export async function attachTag(
  userId: string,
  input: EntityTagInput,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const data = entityTagSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const tag = await tx.tag.findFirst({
      where: { id: data.tagId, userId },
    });

    if (!tag) {
      throw new NotFoundError("Tag not found");
    }

    const attached = await tx.entityTag.create({
      data: {
        userId,
        tagId: data.tagId,
        entityType: data.entityType,
        entityId: data.entityId,
      },
      include: { tag: true },
    });

    await recordAuditLog(tx, {
      userId,
      action: "ENTITY_TAG_ATTACHED",
      entityType: "ENTITY_TAG",
      entityId: attached.id,
      after: attached,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return attached;
  });
}

export async function detachTag(
  userId: string,
  input: EntityTagInput,
  requestMeta?: { ipAddress?: string | null; userAgent?: string | null },
) {
  const data = entityTagSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.entityTag.findUnique({
      where: {
        userId_tagId_entityType_entityId: {
          userId,
          tagId: data.tagId,
          entityType: data.entityType,
          entityId: data.entityId,
        },
      },
    });

    if (!existing) {
      throw new NotFoundError("Entity tag association not found");
    }

    await tx.entityTag.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(tx, {
      userId,
      action: "ENTITY_TAG_DETACHED",
      entityType: "ENTITY_TAG",
      entityId: existing.id,
      before: existing,
      ipAddress: requestMeta?.ipAddress,
      userAgent: requestMeta?.userAgent,
    });

    return { id: existing.id, detached: true };
  });
}
