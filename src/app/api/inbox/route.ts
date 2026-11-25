import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import { ingestInboxItem, listInboxItems } from "@/modules/finances/inbox";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const limit = searchParams.get("limit") ?? undefined;

    const items = await listInboxItems(user.id, {
      status: status as Parameters<typeof listInboxItems>[1] extends {
        status?: infer S;
      }
        ? S
        : never,
      limit: limit ? Number(limit) : undefined,
    });

    return jsonOk(items);
  } catch (err) {
    return handleApiError(err);
  }
}

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
