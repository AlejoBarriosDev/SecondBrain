import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { EntityType, FinancialAccountType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { lockFinancialAccounts } from "@/lib/db/locks";
import { NotFoundError } from "@/lib/api/errors";
import {
  createAttachment,
  deleteAttachment,
  listAttachments,
} from "@/modules/core/attachments";
import { GET as getSettings, PATCH as patchSettings } from "@/app/api/settings/route";
import { GET as getModules, PATCH as patchModules } from "@/app/api/modules/route";
import {
  DELETE as deleteTagRoute,
  GET as getTags,
  POST as postTags,
} from "@/app/api/tags/route";
import {
  DELETE as deleteEntityLinkRoute,
  GET as getEntityLinks,
  POST as postEntityLinks,
} from "@/app/api/entity-links/route";
import { GET as getAuditLogs } from "@/app/api/audit-logs/route";
import { resetTestDatabase } from "../helpers/db-reset";
import { getTestAuthHelpers } from "../helpers/test-auth";

describe("Shared Core APIs, Attachments & Row Locks (integration)", () => {
  let userId: string;
  let authHeaders: Headers;

  beforeEach(async () => {
    await resetTestDatabase();
    process.env.ALLOWED_EMAIL = "owner@secondbrain.local";

    const tu = await getTestAuthHelpers();
    const saved = await tu.saveUser(
      tu.createUser({
        email: "owner@secondbrain.local",
        name: "Owner",
      }),
    );
    userId = saved.id;
    authHeaders = await tu.getAuthHeaders({ userId });
  });

  function makeRequest(
    path: string,
    init?: { method?: string; body?: unknown },
  ): NextRequest {
    const headers = new Headers(authHeaders);
    if (init?.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    return new NextRequest(`http://localhost:3000${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  }

  it("reads and updates UserSettings and writes an AuditLog entry", async () => {
    const getRes = await getSettings(makeRequest("/api/settings"));
    expect(getRes.status).toBe(200);
    const initial = await getRes.json();
    expect(initial.ok).toBe(true);
    expect(initial.data.theme).toBe("DARK");

    const patchRes = await patchSettings(
      makeRequest("/api/settings", {
        method: "PATCH",
        body: {
          theme: "LIGHT",
          defaultCurrency: "EUR",
          locale: "en-US",
        },
      }),
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.data.theme).toBe("LIGHT");
    expect(updated.data.defaultCurrency).toBe("EUR");
    expect(updated.data.locale).toBe("en-US");

    const auditRes = await getAuditLogs(
      makeRequest("/api/audit-logs?action=SETTINGS_UPDATED"),
    );
    expect(auditRes.status).toBe(200);
    const auditBody = await auditRes.json();
    expect(auditBody.data).toHaveLength(1);
    expect(auditBody.meta.total).toBe(1);
  });

  it("reads and updates ModuleConfig entries", async () => {
    const getRes = await getModules(makeRequest("/api/modules"));
    expect(getRes.status).toBe(200);
    const list = await getRes.json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].moduleKey).toBe("finances");

    const patchRes = await patchModules(
      makeRequest("/api/modules", {
        method: "PATCH",
        body: {
          moduleKey: "habits",
          enabled: false,
          sortOrder: 1,
          config: { reminderHour: 9 },
        },
      }),
    );
    expect(patchRes.status).toBe(200);
    const created = await patchRes.json();
    expect(created.data.moduleKey).toBe("habits");
    expect(created.data.enabled).toBe(false);

    const afterRes = await getModules(makeRequest("/api/modules"));
    const afterList = await afterRes.json();
    expect(afterList.data).toHaveLength(2);
  });

  it("handles Tag CRUD, duplicate 409, and EntityTag attach/filter/detach", async () => {
    // Create tag
    const createRes = await postTags(
      makeRequest("/api/tags", {
        method: "POST",
        body: { name: "Reimbursable", color: "#10b981" },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const tagId: string = created.data.id;

    // Duplicate tag name -> 409
    const dupRes = await postTags(
      makeRequest("/api/tags", {
        method: "POST",
        body: { name: "Reimbursable" },
      }),
    );
    expect(dupRes.status).toBe(409);

    // Attach tag to a transaction entity
    const attachRes = await postTags(
      makeRequest("/api/tags", {
        method: "POST",
        body: {
          tagId,
          entityType: EntityType.TRANSACTION,
          entityId: "tx_sample_1",
        },
      }),
    );
    expect(attachRes.status).toBe(201);

    // Filter tags by entity
    const filteredRes = await getTags(
      makeRequest("/api/tags?entityType=TRANSACTION&entityId=tx_sample_1"),
    );
    const filtered = await filteredRes.json();
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].id).toBe(tagId);

    // Detach tag
    const detachRes = await deleteTagRoute(
      makeRequest(
        `/api/tags?tagId=${tagId}&entityType=TRANSACTION&entityId=tx_sample_1`,
        { method: "DELETE" },
      ),
    );
    expect(detachRes.status).toBe(200);

    const afterDetachRes = await getTags(
      makeRequest("/api/tags?entityType=TRANSACTION&entityId=tx_sample_1"),
    );
    expect((await afterDetachRes.json()).data).toHaveLength(0);

    // Delete tag
    const delRes = await deleteTagRoute(
      makeRequest(`/api/tags?id=${tagId}`, { method: "DELETE" }),
    );
    expect(delRes.status).toBe(200);
  });

  it("handles EntityLink CRUD, self-link 400 rejection, and duplicate 409", async () => {
    // Self-link rejected with 400
    const selfRes = await postEntityLinks(
      makeRequest("/api/entity-links", {
        method: "POST",
        body: {
          sourceType: EntityType.TRANSACTION,
          sourceId: "tx_1",
          targetType: EntityType.TRANSACTION,
          targetId: "tx_1",
          relationType: "related",
        },
      }),
    );
    expect(selfRes.status).toBe(400);

    // Create valid link
    const createRes = await postEntityLinks(
      makeRequest("/api/entity-links", {
        method: "POST",
        body: {
          sourceType: EntityType.TRANSACTION,
          sourceId: "tx_1",
          targetType: EntityType.BUDGET,
          targetId: "bud_1",
          relationType: "tracks",
        },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const linkId: string = created.data.id;

    // Duplicate link -> 409
    const dupRes = await postEntityLinks(
      makeRequest("/api/entity-links", {
        method: "POST",
        body: {
          sourceType: EntityType.TRANSACTION,
          sourceId: "tx_1",
          targetType: EntityType.BUDGET,
          targetId: "bud_1",
          relationType: "tracks",
        },
      }),
    );
    expect(dupRes.status).toBe(409);

    // Query by target entity
    const listRes = await getEntityLinks(
      makeRequest("/api/entity-links?entityType=BUDGET&entityId=bud_1"),
    );
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).data).toHaveLength(1);

    // Delete link
    const delRes = await deleteEntityLinkRoute(
      makeRequest(`/api/entity-links?id=${linkId}`, { method: "DELETE" }),
    );
    expect(delRes.status).toBe(200);
  });

  it("enforces userId tenant isolation on Attachments and lockFinancialAccounts", async () => {
    const otherUser = await prisma.user.create({
      data: {
        email: "other@secondbrain.local",
        name: "Other User",
      },
    });

    // Attachment created by owner cannot be read or deleted by otherUser
    const att = await createAttachment(userId, {
      entityType: EntityType.EMAIL_IMPORT_ITEM,
      entityId: "imp_1",
      fileName: "bank.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      storageKey: "pdfs/bank.pdf",
    });

    const otherList = await listAttachments(
      otherUser.id,
      EntityType.EMAIL_IMPORT_ITEM,
      "imp_1",
    );
    expect(otherList).toHaveLength(0);

    await expect(deleteAttachment(otherUser.id, att.id)).rejects.toThrow(
      NotFoundError,
    );

    // lockFinancialAccounts acquires FOR UPDATE locks in sorted order and enforces ownership
    const accA = await prisma.financialAccount.create({
      data: {
        userId,
        name: "Checking",
        type: FinancialAccountType.BANK,
        currency: "USD",
        balance: "500.2500",
      },
    });
    const accB = await prisma.financialAccount.create({
      data: {
        userId,
        name: "Savings",
        type: FinancialAccountType.BANK,
        currency: "USD",
        balance: "1200.0000",
      },
    });

    const locked = await prisma.$transaction(async (tx) => {
      return lockFinancialAccounts(tx, userId, [accB.id, accA.id, accA.id]);
    });
    expect(locked.size).toBe(2);
    expect(locked.get(accA.id)?.balance.toFixed(4)).toBe("500.2500");

    // Wrong userId must fail with NotFoundError
    await expect(
      prisma.$transaction(async (tx) => {
        return lockFinancialAccounts(tx, otherUser.id, [accA.id]);
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
