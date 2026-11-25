import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import { ingestInboxItem } from "@/modules/finances/inbox";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const result = await ingestInboxItem(user.id, body);
    return jsonOk(result.item, result.created ? 201 : 200);
  } catch (err) {
    return handleApiError(err);
  }
}
