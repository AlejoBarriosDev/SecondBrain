import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health (integration)", () => {
  it("returns 200 ok with connected PostgreSQL status", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("ok");
    expect(json.data.db).toBe("connected");
    expect(typeof json.data.timestamp).toBe("string");
  });
});
