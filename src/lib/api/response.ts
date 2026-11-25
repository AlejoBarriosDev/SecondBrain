import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { AppError } from "./errors";

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true as const, data }, { status });
}

export function jsonPaginated<T>(data: T[], meta: PaginationMeta, status = 200) {
  return NextResponse.json({ ok: true as const, data, meta }, { status });
}

export async function parseOptionalJsonBody(
  request: Pick<Request, "text">,
): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }
  return JSON.parse(text);
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  fieldErrors?: Record<string, string[]>,
) {
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code,
        message,
        ...(fieldErrors && Object.keys(fieldErrors).length > 0
          ? { fieldErrors }
          : {}),
      },
    },
    { status },
  );
}

export function handleApiError(err: unknown) {
  if (err instanceof AppError) {
    return jsonError(err.code, err.message, err.status, err.fieldErrors);
  }

  if (err instanceof ZodError) {
    const flattened = z.flattenError(err);
    const fieldErrors: Record<string, string[]> = {};
    for (const [key, messages] of Object.entries(flattened.fieldErrors)) {
      if (Array.isArray(messages) && messages.length > 0) {
        fieldErrors[key] = messages;
      }
    }
    if (flattened.formErrors.length > 0) {
      fieldErrors._form = flattened.formErrors;
    }
    return jsonError(
      "VALIDATION_ERROR",
      flattened.formErrors[0] ?? "Validation failed",
      400,
      fieldErrors,
    );
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return jsonError("CONFLICT", "A duplicate record already exists", 409);
    }
    if (err.code === "P2025") {
      return jsonError("NOT_FOUND", "Record not found", 404);
    }
    if (err.code === "P2003") {
      return jsonError(
        "INVALID_REFERENCE",
        "Referenced record does not exist",
        400,
      );
    }
  }

  if (err instanceof SyntaxError && err.message.includes("JSON")) {
    return jsonError("INVALID_JSON", "Malformed JSON request body", 400);
  }

  console.error("[API Error]", err);
  return jsonError("INTERNAL_ERROR", "An unexpected error occurred", 500);
}
