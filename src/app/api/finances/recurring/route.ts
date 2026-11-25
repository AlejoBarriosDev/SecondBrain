import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  createRecurringRule,
  listRecurringRules,
} from "@/modules/finances/recurring";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const rules = await listRecurringRules(user.id);
    return jsonOk(rules);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const created = await createRecurringRule(
      user.id,
      body,
      extractRequestMeta(request.headers),
    );
    return jsonOk(created, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
