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
    const rawEntityId = searchParams.get("entityId");
    const rawSourceType = searchParams.get("sourceType");
    const rawSourceId = searchParams.get("sourceId");

    let entityType: EntityType | undefined;
    let entityId: string | undefined;
    if (rawEntityType !== null || rawEntityId !== null) {
      entityType = entityTypeSchema.parse(rawEntityType ?? "");
      entityId = z
        .string()
        .trim()
        .min(1, "entityId is required when filtering by entityType")
        .parse(rawEntityId ?? "");
    }

    let sourceType: EntityType | undefined;
    if (rawSourceType !== null) {
      sourceType = entityTypeSchema.parse(rawSourceType);
    }

    let sourceId: string | undefined;
    if (rawSourceId !== null) {
      sourceId = z
        .string()
        .trim()
        .min(1, "sourceId must not be empty")
        .parse(rawSourceId);
    }

    const links = await listEntityLinks(user.id, {
      entityType,
      entityId,
      sourceType,
      sourceId,
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
