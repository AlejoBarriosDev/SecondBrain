import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  handleApiError,
  jsonOk,
  parseOptionalJsonBody,
} from "@/lib/api/response";
import { rejectInboxItem } from "@/modules/finances/inbox";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id } = await context.params;
    const rawBody = await parseOptionalJsonBody(request);
    const rejected = await rejectInboxItem(
      user.id,
      id,
      (rawBody ?? {}) as Parameters<typeof rejectInboxItem>[2],
      extractRequestMeta(request.headers),
    );
    return jsonOk(rejected, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
