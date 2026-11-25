import { EntityType } from "@prisma/client";
import type { PrismaDb } from "@/lib/db/prisma";

/**
 * Deletes all polymorphic references (EntityTag, EntityLink, Attachment)
 * pointing to the given entity ID(s) inside the caller's transaction.
 */
export async function cleanupPolymorphicEntityRefs(
  tx: PrismaDb,
  userId: string,
  entityType: EntityType,
  entityIds: string | string[],
): Promise<void> {
  const ids = Array.isArray(entityIds) ? entityIds : [entityIds];
  if (ids.length === 0) {
    return;
  }

  await Promise.all([
    tx.entityTag.deleteMany({
      where: {
        userId,
        entityType,
        entityId: { in: ids },
      },
    }),
    tx.entityLink.deleteMany({
      where: {
        userId,
        OR: [
          { sourceType: entityType, sourceId: { in: ids } },
          { targetType: entityType, targetId: { in: ids } },
        ],
      },
    }),
    tx.attachment.deleteMany({
      where: {
        userId,
        entityType,
        entityId: { in: ids },
      },
    }),
  ]);
}
