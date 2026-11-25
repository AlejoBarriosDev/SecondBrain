import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import { deleteTransfer } from "@/modules/finances/transfers";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ transferGroupId: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { transferGroupId } = await context.params;
    const result = await deleteTransfer(
      user.id,
      transferGroupId,
      extractRequestMeta(request.headers),
    );
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
