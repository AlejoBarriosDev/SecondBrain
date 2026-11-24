import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireSession } from "@/lib/auth/session";
import { seedUserDefaults, STARTER_CATEGORIES } from "@/modules/core/seed-defaults";
import { GET as getSettings } from "@/app/api/settings/route";
import { GET as getModules } from "@/app/api/modules/route";
import { GET as getTags } from "@/app/api/tags/route";
import { GET as getEntityLinks } from "@/app/api/entity-links/route";
import { GET as getAuditLogs } from "@/app/api/audit-logs/route";
import { resetTestDatabase } from "../helpers/db-reset";
import { getTestAuthHelpers } from "../helpers/test-auth";

describe("Auth security & ALLOWED_EMAIL fail-closed hooks (integration)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    process.env.ALLOWED_EMAIL = "owner@secondbrain.local";
  });

  it("allows authorized user creation and automatically seeds UserSettings, ModuleConfig, and starter Categories", async () => {
    const tu = await getTestAuthHelpers();
    const user = tu.createUser({
      email: "owner@secondbrain.local",
      name: "Authorized Owner",
    });

    const saved = await tu.saveUser(user);
    expect(saved.email).toBe("owner@secondbrain.local");

    const settings = await prisma.userSettings.findUnique({
      where: { userId: saved.id },
    });
    expect(settings).not.toBeNull();
    expect(settings?.theme).toBe("DARK");
    expect(settings?.defaultCurrency).toBe("USD");

    const modules = await prisma.moduleConfig.findMany({
      where: { userId: saved.id },
    });
    expect(modules).toHaveLength(1);
    expect(modules[0]?.moduleKey).toBe("finances");
    expect(modules[0]?.enabled).toBe(true);

    const categories = await prisma.category.findMany({
      where: { userId: saved.id },
    });
    expect(categories).toHaveLength(STARTER_CATEGORIES.length);

    // Calling seedUserDefaults again must be strictly idempotent
    await seedUserDefaults(prisma, saved.id);
    const categoriesAfterReseed = await prisma.category.findMany({
      where: { userId: saved.id },
    });
    expect(categoriesAfterReseed).toHaveLength(STARTER_CATEGORIES.length);
  });

  it("rejects unauthorized email on user creation (FORBIDDEN) and inserts 0 rows", async () => {
    const tu = await getTestAuthHelpers();
    const intruder = tu.createUser({
      email: "intruder@evil.test",
      name: "Intruder",
    });

    await expect(tu.saveUser(intruder)).rejects.toThrow(
      /Access restricted to authorized account/i,
    );

    const userCount = await prisma.user.count();
    expect(userCount).toBe(0);
  });

  it("blocks session creation if ALLOWED_EMAIL changes after user creation", async () => {
    const tu = await getTestAuthHelpers();
    const user = tu.createUser({
      email: "owner@secondbrain.local",
      name: "Owner",
    });
    const saved = await tu.saveUser(user);

    // Change ALLOWED_EMAIL so the existing user is no longer authorized
    process.env.ALLOWED_EMAIL = "different@secondbrain.local";

    await expect(tu.login({ userId: saved.id })).rejects.toThrow(
      /Access restricted to authorized account/i,
    );
  });

  it("issues valid session cookies recognized by requireSession()", async () => {
    const tu = await getTestAuthHelpers();
    const saved = await tu.saveUser(
      tu.createUser({
        email: "owner@secondbrain.local",
        name: "Owner",
      }),
    );

    const headers = await tu.getAuthHeaders({ userId: saved.id });
    const session = await requireSession(headers);

    expect(session.user.id).toBe(saved.id);
    expect(session.user.email).toBe("owner@secondbrain.local");
  });

  it("returns 401 UNAUTHORIZED for unauthenticated requests to all Shared Core APIs", async () => {
    const endpoints = [
      { name: "settings", handler: getSettings, url: "http://localhost:3000/api/settings" },
      { name: "modules", handler: getModules, url: "http://localhost:3000/api/modules" },
      { name: "tags", handler: getTags, url: "http://localhost:3000/api/tags" },
      { name: "entity-links", handler: getEntityLinks, url: "http://localhost:3000/api/entity-links" },
      { name: "audit-logs", handler: getAuditLogs, url: "http://localhost:3000/api/audit-logs" },
    ];

    for (const ep of endpoints) {
      const req = new NextRequest(ep.url, { method: "GET" });
      const res = await ep.handler(req);
      expect(res.status, `${ep.name} should return 401`).toBe(401);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    }
  });
});
