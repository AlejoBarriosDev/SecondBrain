import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  dashboardQuerySchema,
  getFinanceDashboard,
} from "@/modules/finances/dashboard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { searchParams } = request.nextUrl;
    const params = dashboardQuerySchema.parse({
      year: searchParams.get("year") ?? undefined,
      month: searchParams.get("month") ?? undefined,
    });
    const dashboard = await getFinanceDashboard(user.id, params);
    return jsonOk(dashboard);
  } catch (err) {
    return handleApiError(err);
  }
}
