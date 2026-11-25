import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  archiveAccount,
  getAccountById,
  updateAccount,
} from "@/modules/finances/accounts";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id } = await context.params;
    const account = await getAccountById(user.id, id);
    return jsonOk(account);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id } = await context.params;
    const body = await request.json();
    const updated = await updateAccount(
      user.id,
      id,
      body,
      extractRequestMeta(request.headers),
    );
    return jsonOk(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id } = await context.params;
    const archived = await archiveAccount(
      user.id,
      id,
      extractRequestMeta(request.headers),
    );
    return jsonOk(archived);
  } catch (err) {
    return handleApiError(err);
  }
}
