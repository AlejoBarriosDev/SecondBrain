import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  EmailImportStatus,
  EntityType,
  FinancialAccountType,
  TransactionType,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { formatDecimal } from "@/lib/db/decimal";
import { createAccount } from "@/modules/finances/accounts";
import { createCategory } from "@/modules/finances/categories";
import { GET as listInboxRoute } from "@/app/api/inbox/route";
import { POST as ingestInboxRoute } from "@/app/api/inbox/ingest/route";
import { POST as syncInboxRoute } from "@/app/api/inbox/sync/route";
import {
  GET as getInboxItemRoute,
  PATCH as patchInboxItemRoute,
} from "@/app/api/inbox/[id]/route";
import { POST as confirmInboxItemRoute } from "@/app/api/inbox/[id]/confirm/route";
import { POST as rejectInboxItemRoute } from "@/app/api/inbox/[id]/reject/route";
import { resetTestDatabase } from "../helpers/db-reset";
import { getTestAuthHelpers } from "../helpers/test-auth";

function buildMinimalPdfBase64(text: string): string {
  const escaped = text
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
  const streamContent = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const streamLength = Buffer.byteLength(streamContent, "utf8");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${streamLength} >>\nstream\n${streamContent}endstream\nendobj\n`,
  ];

  const header = "%PDF-1.4\n";
  const parts: string[] = [header];
  const offsets: number[] = [];
  let cursor = Buffer.byteLength(header, "utf8");

  for (const obj of objects) {
    offsets.push(cursor);
    parts.push(obj);
    cursor += Buffer.byteLength(obj, "utf8");
  }

  const xrefOffset = cursor;
  parts.push(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((off) => `${String(off).padStart(10, "0")} 00000 n \n`).join(""),
  );
  parts.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return Buffer.from(parts.join(""), "utf8").toString("base64");
}

function makeRequest(
  url: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): NextRequest {
  const headers = new Headers();
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

describe("Review Inbox API & Atomic Concurrency Integration Tests (Real Postgres)", () => {
  let userId: string;
  let cookieHeader: string;

  beforeEach(async () => {
    await resetTestDatabase();
    process.env.ALLOWED_EMAIL = "owner@secondbrain.local";

    const tu = await getTestAuthHelpers();
    const user = await tu.saveUser(
      tu.createUser({
        email: "owner@secondbrain.local",
        name: "Owner",
      }),
    );
    userId = user.id;

    const login = await tu.login({ userId: user.id });
    cookieHeader = login.headers.get("cookie") ?? "";
  });

  it("enforces 401 for unauthenticated requests and 403 for non-owner sessions", async () => {
    const unauthRes = await listInboxRoute(
      makeRequest("http://localhost:3000/api/inbox"),
    );
    expect(unauthRes.status).toBe(401);
    const unauthBody = await unauthRes.json();
    expect(unauthBody.ok).toBe(false);

    // Mutate user email to unauthorized address -> requireSession returns 403
    await prisma.user.update({
      where: { id: userId },
      data: { email: "intruder@evil.test" },
    });
    const forbiddenRes = await listInboxRoute(
      makeRequest("http://localhost:3000/api/inbox", { cookie: cookieHeader }),
    );
    expect(forbiddenRes.status).toBe(403);
    const forbiddenBody = await forbiddenRes.json();
    expect(forbiddenBody.ok).toBe(false);
  });

  it("ingests EN email, real PDF, corrupt PDF, and deduplicates externalMessageId with strict F-FIN-06 staging isolation", async () => {
    const account = await createAccount(userId, {
      name: "Checking",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "1000.0000",
    });

    // 1. Ingest EN email
    const emailRes = await ingestInboxRoute(
      makeRequest("http://localhost:3000/api/inbox/ingest", {
        method: "POST",
        cookie: cookieHeader,
        body: {
          externalMessageId: "int-en-001",
          fromAddress: "alerts@bank.test",
          subject: "Purchase alert: USD 45.50 at Whole Foods",
          bodyText:
            "You made a debit card purchase of $45.50 USD at Whole Foods Market on 2026-11-20.",
          receivedAt: "2026-11-20T14:00:00.000Z",
        },
      }),
    );
    expect(emailRes.status).toBe(201);
    const emailBody = await emailRes.json();
    expect(emailBody.ok).toBe(true);
    expect(emailBody.data.status).toBe(EmailImportStatus.PENDING);
    expect(emailBody.data.parsedAmount).toBe("45.5000");
    expect(emailBody.data.parsedCurrency).toBe("USD");
    expect(emailBody.data.parsedMerchant).toBe("Whole Foods Market");

    // 2. Duplicate externalMessageId -> returns 200 with same item ID, no duplicate created
    const dupRes = await ingestInboxRoute(
      makeRequest("http://localhost:3000/api/inbox/ingest", {
        method: "POST",
        cookie: cookieHeader,
        body: {
          externalMessageId: "int-en-001",
          subject: "Purchase alert: USD 45.50 at Whole Foods",
          bodyText: "Duplicate delivery",
        },
      }),
    );
    expect(dupRes.status).toBe(200);
    const dupBody = await dupRes.json();
    expect(dupBody.data.id).toBe(emailBody.data.id);

    // 3. Ingest real minimal PDF
    const pdfRes = await ingestInboxRoute(
      makeRequest("http://localhost:3000/api/inbox/ingest", {
        method: "POST",
        cookie: cookieHeader,
        body: {
          externalMessageId: "int-pdf-002",
          fromAddress: "estados@banco.test",
          subject: "Extracto bancario PDF",
          bodyText: "Adjunto su extracto mensual.",
          pdfBase64: buildMinimalPdfBase64(
            "Compra aprobada por USD 80.00 en Amazon Web Services",
          ),
          pdfFileName: "extracto.pdf",
        },
      }),
    );
    expect(pdfRes.status).toBe(201);
    const pdfBody = await pdfRes.json();
    expect(pdfBody.data.hasPdfAttachment).toBe(true);
    expect(pdfBody.data.parsedAmount).toBe("80.0000");
    expect(pdfBody.data.parsedMerchant).toBe("Amazon Web Services");

    const attachmentRow = await prisma.attachment.findFirst({
      where: {
        userId,
        entityType: EntityType.EMAIL_IMPORT_ITEM,
        entityId: pdfBody.data.id,
      },
    });
    expect(attachmentRow).not.toBeNull();
    expect(attachmentRow?.fileName).toBe("extracto.pdf");

    // 4. Ingest corrupt PDF -> degrades gracefully into PENDING item (no 500)
    const corruptRes = await ingestInboxRoute(
      makeRequest("http://localhost:3000/api/inbox/ingest", {
        method: "POST",
        cookie: cookieHeader,
        body: {
          externalMessageId: "int-corrupt-003",
          subject: "Corrupted statement",
          bodyText: "See attached PDF.",
          pdfBase64: Buffer.from("NOT_A_REAL_PDF").toString("base64"),
          pdfFileName: "corrupt.pdf",
        },
      }),
    );
    expect(corruptRes.status).toBe(201);
    const corruptBody = await corruptRes.json();
    expect(corruptBody.data.status).toBe(EmailImportStatus.PENDING);
    expect(corruptBody.data.hasPdfAttachment).toBe(true);
    expect(corruptBody.data.parserNotes).toMatch(/extraction failed/i);

    // F-FIN-06: Staging isolation — zero Transaction rows & untouched account balance
    const accAfter = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(formatDecimal(accAfter.balance)).toBe("1000.0000");
    const txCount = await prisma.transaction.count({ where: { userId } });
    expect(txCount).toBe(0);
  });

  it("degrades gracefully with 412 GMAIL_NOT_CONNECTED on POST /api/inbox/sync when Google OAuth is not connected", async () => {
    const res = await syncInboxRoute(
      makeRequest("http://localhost:3000/api/inbox/sync", {
        method: "POST",
        cookie: cookieHeader,
      }),
    );
    expect(res.status).toBe(412);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("GMAIL_NOT_CONNECTED");
  });

  it("supports GET/PATCH/confirm/reject lifecycle with AuditLog and 409 state guards", async () => {
    const account = await createAccount(userId, {
      name: "Main Bank",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "1000.0000",
    });
    const category = await createCategory(userId, {
      name: "Dining",
      type: TransactionType.EXPENSE,
    });

    const ingest1 = await (
      await ingestInboxRoute(
        makeRequest("http://localhost:3000/api/inbox/ingest", {
          method: "POST",
          cookie: cookieHeader,
          body: {
            externalMessageId: "lifecycle-1",
            bodyText: "Compra aprobada por USD 64.25 en Cafe Central",
          },
        }),
      )
    ).json();

    const ingest2 = await (
      await ingestInboxRoute(
        makeRequest("http://localhost:3000/api/inbox/ingest", {
          method: "POST",
          cookie: cookieHeader,
          body: {
            externalMessageId: "lifecycle-2",
            bodyText: "Card charge USD 110.00 at Metro Airlines",
          },
        }),
      )
    ).json();

    // GET /api/inbox?status=PENDING
    const listRes = await listInboxRoute(
      makeRequest("http://localhost:3000/api/inbox?status=PENDING", {
        cookie: cookieHeader,
      }),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.data).toHaveLength(2);

    // PATCH /api/inbox/[id] before confirm
    const patchRes = await patchInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${ingest1.data.id}`, {
        method: "PATCH",
        cookie: cookieHeader,
        body: {
          suggestedAccountId: account.id,
          suggestedCategoryId: category.id,
          parsedMerchant: "Cafe Central Downtown",
        },
      }),
      { params: Promise.resolve({ id: ingest1.data.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.suggestedAccountId).toBe(account.id);
    expect(patchBody.data.parsedMerchant).toBe("Cafe Central Downtown");

    // POST /api/inbox/[id]/confirm -> 200, updates balance to 935.7500, writes AuditLog
    const confirmRes = await confirmInboxItemRoute(
      makeRequest(
        `http://localhost:3000/api/inbox/${ingest1.data.id}/confirm`,
        {
          method: "POST",
          cookie: cookieHeader,
          body: {},
        },
      ),
      { params: Promise.resolve({ id: ingest1.data.id }) },
    );
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json();
    expect(confirmBody.data.item.status).toBe(EmailImportStatus.CONFIRMED);
    expect(confirmBody.data.transaction.amount).toBe("64.2500");
    expect(confirmBody.data.transaction.emailImportItemId).toBe(
      ingest1.data.id,
    );

    const accAfterConfirm = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(formatDecimal(accAfterConfirm.balance)).toBe("935.7500");

    // PATCH after CONFIRMED -> 409 CONFLICT
    const patchConfirmedRes = await patchInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${ingest1.data.id}`, {
        method: "PATCH",
        cookie: cookieHeader,
        body: { parsedMerchant: "Should Fail" },
      }),
      { params: Promise.resolve({ id: ingest1.data.id }) },
    );
    expect(patchConfirmedRes.status).toBe(409);

    // GET /api/inbox/[id]
    const getRes = await getInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${ingest1.data.id}`, {
        cookie: cookieHeader,
      }),
      { params: Promise.resolve({ id: ingest1.data.id }) },
    );
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).data.status).toBe(EmailImportStatus.CONFIRMED);

    // POST /api/inbox/[id]/reject -> 200, zero balance change, AuditLog recorded
    const rejectRes = await rejectInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${ingest2.data.id}/reject`, {
        method: "POST",
        cookie: cookieHeader,
      }),
      { params: Promise.resolve({ id: ingest2.data.id }) },
    );
    expect(rejectRes.status).toBe(200);
    expect((await rejectRes.json()).data.status).toBe(
      EmailImportStatus.REJECTED,
    );

    const accAfterReject = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(formatDecimal(accAfterReject.balance)).toBe("935.7500");

    // Second reject and confirm-after-reject both return 409
    const rejectAgain = await rejectInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${ingest2.data.id}/reject`, {
        method: "POST",
        cookie: cookieHeader,
      }),
      { params: Promise.resolve({ id: ingest2.data.id }) },
    );
    expect(rejectAgain.status).toBe(409);

    const confirmRejected = await confirmInboxItemRoute(
      makeRequest(
        `http://localhost:3000/api/inbox/${ingest2.data.id}/confirm`,
        {
          method: "POST",
          cookie: cookieHeader,
          body: { accountId: account.id },
        },
      ),
      { params: Promise.resolve({ id: ingest2.data.id }) },
    );
    expect(confirmRejected.status).toBe(409);

    // Verify AuditLogs
    const audits = await prisma.auditLog.findMany({
      where: { userId, entityType: "EMAIL_IMPORT_ITEM" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual([
      "INBOX_ITEM_UPDATED",
      "INBOX_ITEM_CONFIRMED",
      "INBOX_ITEM_REJECTED",
    ]);
  });

  it("prevents double-spend under true concurrent double-confirm race (Promise.all -> one 200, one 409, balance mutated once)", async () => {
    const account = await createAccount(userId, {
      name: "Race Account",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "500.0000",
    });

    const ingested = await (
      await ingestInboxRoute(
        makeRequest("http://localhost:3000/api/inbox/ingest", {
          method: "POST",
          cookie: cookieHeader,
          body: {
            externalMessageId: "race-double-confirm-1",
            bodyText: "Card charge USD 125.00 at Race Merchant",
          },
        }),
      )
    ).json();

    const itemId = ingested.data.id as string;
    const confirmBody = {
      accountId: account.id,
      type: TransactionType.EXPENSE,
      amount: "125.0000",
      description: "Race Merchant",
    };

    const [resA, resB] = await Promise.all([
      confirmInboxItemRoute(
        makeRequest(`http://localhost:3000/api/inbox/${itemId}/confirm`, {
          method: "POST",
          cookie: cookieHeader,
          body: confirmBody,
        }),
        { params: Promise.resolve({ id: itemId }) },
      ),
      confirmInboxItemRoute(
        makeRequest(`http://localhost:3000/api/inbox/${itemId}/confirm`, {
          method: "POST",
          cookie: cookieHeader,
          body: confirmBody,
        }),
        { params: Promise.resolve({ id: itemId }) },
      ),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const txCount = await prisma.transaction.count({
      where: { userId, emailImportItemId: itemId },
    });
    expect(txCount).toBe(1);

    const finalAcc = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(formatDecimal(finalAcc.balance)).toBe("375.0000");
  });

  it("rejects archived suggestedAccountId on PATCH /api/inbox/[id] with 400 VALIDATION_ERROR", async () => {
    const archivedAccount = await createAccount(userId, {
      name: "Archived Checking",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "100.0000",
    });
    await prisma.financialAccount.update({
      where: { id: archivedAccount.id },
      data: { isArchived: true },
    });

    const ingested = await (
      await ingestInboxRoute(
        makeRequest("http://localhost:3000/api/inbox/ingest", {
          method: "POST",
          cookie: cookieHeader,
          body: {
            externalMessageId: "archived-account-patch-1",
            bodyText: "Card charge USD 25.00 at Corner Shop",
          },
        }),
      )
    ).json();

    const itemId = ingested.data.id as string;
    const patchRes = await patchInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${itemId}`, {
        method: "PATCH",
        cookie: cookieHeader,
        body: {
          suggestedAccountId: archivedAccount.id,
        },
      }),
      { params: Promise.resolve({ id: itemId }) },
    );

    expect(patchRes.status).toBe(400);
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(false);
    expect(patchBody.error.code).toBe("VALIDATION_ERROR");
    expect(patchBody.error.fieldErrors?.suggestedAccountId).toEqual([
      "Account is archived",
    ]);

    const dbItem = await prisma.emailImportItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(dbItem.suggestedAccountId).toBeNull();
  });

  it("returns 400 VALIDATION_ERROR and rolls back atomically when confirm would overflow Decimal(19,4) account balance", async () => {
    const account = await createAccount(userId, {
      name: "Near Max Account",
      type: FinancialAccountType.BANK,
      currency: "USD",
      balance: "999999999999990.0000",
    });

    const ingested = await (
      await ingestInboxRoute(
        makeRequest("http://localhost:3000/api/inbox/ingest", {
          method: "POST",
          cookie: cookieHeader,
          body: {
            externalMessageId: "decimal-overflow-confirm-1",
            bodyText: "Deposit of USD 100.00 from Wire Transfer",
          },
        }),
      )
    ).json();

    const itemId = ingested.data.id as string;
    const confirmRes = await confirmInboxItemRoute(
      makeRequest(`http://localhost:3000/api/inbox/${itemId}/confirm`, {
        method: "POST",
        cookie: cookieHeader,
        body: {
          accountId: account.id,
          type: TransactionType.INCOME,
          amount: "100.0000",
          currency: "USD",
          description: "Overflow test",
        },
      }),
      { params: Promise.resolve({ id: itemId }) },
    );

    expect(confirmRes.status).toBe(400);
    const confirmBody = await confirmRes.json();
    expect(confirmBody.ok).toBe(false);
    expect(confirmBody.error.code).toBe("VALIDATION_ERROR");

    const accAfter = await prisma.financialAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(formatDecimal(accAfter.balance)).toBe("999999999999990.0000");

    const itemAfter = await prisma.emailImportItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(itemAfter.status).toBe(EmailImportStatus.PENDING);

    const txCount = await prisma.transaction.count({
      where: { userId, emailImportItemId: itemId },
    });
    expect(txCount).toBe(0);
  });
});
