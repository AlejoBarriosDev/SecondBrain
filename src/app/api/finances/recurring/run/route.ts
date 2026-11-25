import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { UnauthorizedError } from "@/lib/api/errors";
import { handleApiError, jsonOk } from "@/lib/api/response";
import { runDueRecurringRules } from "@/modules/finances/recurring";
import { extractRequestMeta, isoDateSchema } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

const runBodySchema = z
  .object({
    now: isoDateSchema.optional(),
    userId: z.string().trim().min(1).optional(),
  })
  .optional();

function verifyCronSecret(authHeader: string): boolean {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) {
    return false;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    return false;
  }

  const providedBuf = Buffer.from(match[1], "utf8");
  const expectedBuf = Buffer.from(configuredSecret, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    let isCron = false;
    let sessionUserId: string | undefined;

    if (authHeader && /^Bearer\s+/i.test(authHeader.trim())) {
      if (!verifyCronSecret(authHeader)) {
        throw new UnauthorizedError("Invalid cron authorization token");
      }
      isCron = true;
    } else {
      const { user } = await requireSession(request.headers);
      sessionUserId = user.id;
    }

    let rawBody: unknown = undefined;
    const text = await request.text();
    if (text.trim().length > 0) {
      rawBody = JSON.parse(text);
    }
    const parsedBody = runBodySchema.parse(rawBody);
    const meta = extractRequestMeta(request.headers);

    const summary = await runDueRecurringRules(
      {
        userId: isCron ? parsedBody?.userId : sessionUserId,
        now: parsedBody?.now,
      },
      meta,
    );
    return jsonOk(summary);
  } catch (err) {
    return handleApiError(err);
  }
}
