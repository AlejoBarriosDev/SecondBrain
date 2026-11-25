import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import { getInboxItem, updateInboxItem } from "@/modules/finances/inbox";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id } = await context.params;
    const item = await getInboxItem(user.id, id);
    return jsonOk(item);
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
    const updated = await updateInboxItem(user.id, id, body);
    return jsonOk(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
