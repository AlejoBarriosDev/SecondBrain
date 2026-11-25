import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import { deleteBudget } from "@/modules/finances/budgets";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id } = await context.params;
    const result = await deleteBudget(
      user.id,
      id,
      extractRequestMeta(request.headers),
    );
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}
