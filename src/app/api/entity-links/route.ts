import { NextRequest } from "next/server";
import { EntityType } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { ValidationError } from "@/lib/api/errors";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  createEntityLink,
  deleteEntityLink,
  listEntityLinks,
} from "@/modules/core/entity-links";

export const dynamic = "force-dynamic";

const entityTypeSchema = z.nativeEnum(EntityType);

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { searchParams } = request.nextUrl;

    const rawEntityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId");
    const rawSourceType = searchParams.get("sourceType");
    const sourceId = searchParams.get("sourceId");

    const links = await listEntityLinks(user.id, {
      entityType: rawEntityType
        ? entityTypeSchema.parse(rawEntityType)
        : undefined,
      entityId: entityId ?? undefined,
      sourceType: rawSourceType
        ? entityTypeSchema.parse(rawSourceType)
        : undefined,
      sourceId: sourceId ?? undefined,
    });

    return jsonOk(links);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const created = await createEntityLink(user.id, body, {
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk(created, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      throw new ValidationError("Query parameter ?id=<linkId> is required");
    }

    const deleted = await deleteEntityLink(user.id, id, {
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonOk(deleted);
  } catch (err) {
    return handleApiError(err);
  }
}
