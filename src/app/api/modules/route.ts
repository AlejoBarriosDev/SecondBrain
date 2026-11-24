import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  listModuleConfigs,
  upsertModuleConfig,
} from "@/modules/core/modules";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const modules = await listModuleConfigs(user.id);
    return jsonOk(modules);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const updated = await upsertModuleConfig(user.id, body, {
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
