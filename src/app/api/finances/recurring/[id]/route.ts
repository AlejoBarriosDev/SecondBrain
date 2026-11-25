import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  deleteRecurringRule,
  updateRecurringRule,
} from "@/modules/finances/recurring";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id } = await context.params;
    const body = await request.json();
    const updated = await updateRecurringRule(
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
    const result = await deleteRecurringRule(
      user.id,
      id,
      extractRequestMeta(request.headers),
    );
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
