import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  createCategory,
  listCategories,
  listCategoriesQuerySchema,
} from "@/modules/finances/categories";
import { extractRequestMeta } from "@/modules/finances/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { type } = listCategoriesQuerySchema.parse({
      type: request.nextUrl.searchParams.get("type") ?? undefined,
    });
    const categories = await listCategories(user.id, { type });
    return jsonOk(categories);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const created = await createCategory(
      user.id,
      body,
      extractRequestMeta(request.headers),
    );
    return jsonOk(created, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
