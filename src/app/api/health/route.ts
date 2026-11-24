import { prisma } from "@/lib/db/prisma";
import { jsonError, jsonOk } from "@/lib/api/response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return jsonOk({
      status: "ok",
      db: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Health Check Failed]", err);
    return jsonError(
      "DB_UNAVAILABLE",
      "Database connectivity check failed",
      503,
    );
  }
}
