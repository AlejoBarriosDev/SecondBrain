import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  handleApiError,
  jsonOk,
  parseOptionalJsonBody,
} from "@/lib/api/response";
import { GmailSyncService } from "@/modules/finances/gmail-sync";

export const dynamic = "force-dynamic";

const syncBodySchema = z.object({
  maxResults: z.coerce.number().int().min(1).max(100).optional(),
  query: z.string().trim().min(1).max(500).optional(),
  fullResync: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const rawBody = await parseOptionalJsonBody(request);
    const options = syncBodySchema.parse(rawBody ?? {});

    const service = new GmailSyncService();
    const result = await service.syncUser(user.id, options);
    return jsonOk(result, 200);
  } catch (err) {
    return handleApiError(err);
  }
}
