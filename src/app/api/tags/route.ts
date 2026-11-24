import { NextRequest } from "next/server";
import { EntityType } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { ValidationError } from "@/lib/api/errors";
import { handleApiError, jsonOk } from "@/lib/api/response";
import {
  attachTag,
  createTag,
  deleteTag,
  detachTag,
  listTags,
} from "@/modules/core/tags";

export const dynamic = "force-dynamic";

const entityTypeSchema = z.nativeEnum(EntityType);

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { searchParams } = request.nextUrl;
    const rawEntityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId");

    if (rawEntityType && entityId) {
      const entityType = entityTypeSchema.parse(rawEntityType);
      const tags = await listTags(user.id, { entityType, entityId });
      return jsonOk(tags);
    }

    const tags = await listTags(user.id);
    return jsonOk(tags);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const body = await request.json();
    const requestMeta = {
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    };

    if (
      body &&
      typeof body === "object" &&
      "tagId" in body &&
      "entityType" in body &&
      "entityId" in body
    ) {
      const attached = await attachTag(user.id, body, requestMeta);
      return jsonOk(attached, 201);
    }

    const created = await createTag(user.id, body, requestMeta);
    return jsonOk(created, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireSession(request.headers);
    const { searchParams } = request.nextUrl;
    const requestMeta = {
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    };

    const id = searchParams.get("id");
    if (id) {
      const deleted = await deleteTag(user.id, id, requestMeta);
      return jsonOk(deleted);
    }

    const tagId = searchParams.get("tagId");
    const rawEntityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId");

    if (tagId && rawEntityType && entityId) {
      const entityType = entityTypeSchema.parse(rawEntityType);
      const detached = await detachTag(
        user.id,
        { tagId, entityType, entityId },
        requestMeta,
      );
      return jsonOk(detached);
    }

    throw new ValidationError(
      "Provide either ?id=<tagId> or ?tagId=<id>&entityType=<type>&entityId=<id>",
    );
  } catch (err) {
    return handleApiError(err);
  }
}
