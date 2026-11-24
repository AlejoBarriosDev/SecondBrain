import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonPaginated } from "@/lib/api/response";
import { listAuditLogs } from "@/modules/core/audit-logs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { searchParams } = request.nextUrl;

    const { items, meta } = await listAuditLogs(user.id, {
      entityType: searchParams.get("entityType") ?? undefined,
      entityId: searchParams.get("entityId") ?? undefined,
      action: searchParams.get("action") ?? undefined,
      page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
      pageSize: searchParams.get("pageSize")
        ? Number(searchParams.get("pageSize"))
        : undefined,
    });

    return jsonPaginated(items, meta);
  } catch (err) {
    return handleApiError(err);
  }
}
