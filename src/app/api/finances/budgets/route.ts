import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  listBudgets,
  listBudgetsQuerySchema,
  upsertBudget,
} from "@/modules/finances/budgets";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const now = new Date();
    const { searchParams } = request.nextUrl;
    const params = listBudgetsQuerySchema.parse({
      year: searchParams.get("year") ?? now.getUTCFullYear(),
      month: searchParams.get("month") ?? now.getUTCMonth() + 1,
    });
    const budgets = await listBudgets(user.id, params);
    return jsonOk(budgets);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const saved = await upsertBudget(
      user.id,
      body,
      extractRequestMeta(request.headers),
    );
    return jsonOk(saved, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
