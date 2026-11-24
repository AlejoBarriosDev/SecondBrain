import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  getUserSettings,
  updateUserSettings,
} from "@/modules/core/settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const settings = await getUserSettings(user.id);
    return jsonOk(settings);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const updated = await updateUserSettings(user.id, body, {
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
