import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  createAccount,
  listAccounts,
  listAccountsQuerySchema,
} from "@/modules/finances/accounts";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { includeArchived } = listAccountsQuerySchema.parse({
      includeArchived:
        request.nextUrl.searchParams.get("includeArchived") ?? undefined,
    });
    const accounts = await listAccounts(user.id, { includeArchived });
    return jsonOk(accounts);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const created = await createAccount(
      user.id,
      body,
      extractRequestMeta(request.headers),
    );
    return jsonOk(created, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
