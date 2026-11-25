import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk, jsonPaginated } from "@/lib/api/response";
import { createTransfer, listTransfers } from "@/modules/finances/transfers";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { searchParams } = request.nextUrl;
    const result = await listTransfers(user.id, {
      accountId: searchParams.get("accountId") ?? undefined,
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      page: searchParams.get("page")
        ? Number(searchParams.get("page"))
        : undefined,
      pageSize: searchParams.get("pageSize")
        ? Number(searchParams.get("pageSize"))
        : undefined,
    });
    return jsonPaginated(result.items, result.meta);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const created = await createTransfer(
      user.id,
      body,
      extractRequestMeta(request.headers),
    );
    return jsonOk(created, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
