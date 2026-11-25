import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk, jsonPaginated } from "@/lib/api/response";
import {
  createTransaction,
  listTransactions,
  listTransactionsQuerySchema,
} from "@/modules/finances/transactions";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { searchParams } = request.nextUrl;
    const query = listTransactionsQuerySchema.parse({
      accountId: searchParams.get("accountId") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      type: searchParams.get("type") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      tagId: searchParams.get("tagId") ?? undefined,
      q: searchParams.get("q") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      pageSize: searchParams.get("pageSize") ?? undefined,
    });
    const result = await listTransactions(user.id, query);
    return jsonPaginated(result.items, result.meta);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const created = await createTransaction(
      user.id,
      body,
      extractRequestMeta(request.headers),
    );
    return jsonOk(created, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
