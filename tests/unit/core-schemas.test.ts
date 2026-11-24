import { describe, expect, it } from "vitest";
import { EntityType, ThemeMode } from "@prisma/client";
import { updateSettingsSchema } from "@/modules/core/settings";
import { updateModuleConfigSchema } from "@/modules/core/modules";
import { createTagSchema, entityTagSchema } from "@/modules/core/tags";
import { createEntityLinkSchema } from "@/modules/core/entity-links";
import {
  createAttachmentSchema,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/modules/core/attachments";

describe("Shared Core Zod schemas", () => {
  it("validates UserSettings updates", () => {
    const valid = updateSettingsSchema.parse({
      defaultCurrency: "EUR",
      locale: "es-ES",
      timezone: "Europe/Madrid",
      theme: ThemeMode.LIGHT,
      fiscalMonthStartDay: 15,
      aiParserEnabled: false,
    });
    expect(valid.defaultCurrency).toBe("EUR");
    expect(valid.theme).toBe("LIGHT");

    expect(() =>
      updateSettingsSchema.parse({ defaultCurrency: "usd" }),
    ).toThrow();
    expect(() =>
      updateSettingsSchema.parse({ fiscalMonthStartDay: 31 }),
    ).toThrow();
  });

  it("validates ModuleConfig updates", () => {
    const valid = updateModuleConfigSchema.parse({
      moduleKey: "finances",
      enabled: true,
      sortOrder: 0,
      config: { compactMode: true },
    });
    expect(valid.moduleKey).toBe("finances");

    expect(() =>
      updateModuleConfigSchema.parse({ moduleKey: "Invalid Key!" }),
    ).toThrow();
  });

  it("validates Tag and EntityTag schemas", () => {
    const tag = createTagSchema.parse({ name: "Tax Deductible" });
    expect(tag.color).toBe("#6366f1");

    expect(() =>
      createTagSchema.parse({ name: "Bad Color", color: "red" }),
    ).toThrow();

    const et = entityTagSchema.parse({
      tagId: "tag_123",
      entityType: EntityType.TRANSACTION,
      entityId: "tx_456",
    });
    expect(et.entityType).toBe("TRANSACTION");
  });

  it("validates EntityLink and rejects self-links", () => {
    const valid = createEntityLinkSchema.parse({
      sourceType: EntityType.TRANSACTION,
      sourceId: "tx_1",
      targetType: EntityType.BUDGET,
      targetId: "bud_1",
      relationType: "belongs_to_goal",
    });
    expect(valid.relationType).toBe("belongs_to_goal");

    expect(() =>
      createEntityLinkSchema.parse({
        sourceType: EntityType.TRANSACTION,
        sourceId: "tx_1",
        targetType: EntityType.TRANSACTION,
        targetId: "tx_1",
        relationType: "self_ref",
      }),
    ).toThrow(/cannot be linked to itself/i);
  });

  it("validates Attachment schema including 10MB size limit", () => {
    const valid = createAttachmentSchema.parse({
      entityType: EntityType.EMAIL_IMPORT_ITEM,
      entityId: "imp_1",
      fileName: "statement-2026.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      storageKey: "uploads/statement-2026.pdf",
    });
    expect(valid.sizeBytes).toBe(1024);

    expect(() =>
      createAttachmentSchema.parse({
        entityType: EntityType.EMAIL_IMPORT_ITEM,
        entityId: "imp_1",
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        sizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1,
        storageKey: "uploads/huge.pdf",
      }),
    ).toThrow();
  });
});
