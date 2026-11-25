import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import nextConfig from "../../next.config";

const ROOT_DIR = path.resolve(__dirname, "../..");
const ICONS_DIR = path.join(ROOT_DIR, "public", "icons");
const SW_PATH = path.join(ROOT_DIR, "public", "sw.js");
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe("PWA Manifest (src/app/manifest.ts)", () => {
  it("returns a valid standalone dark-first Web App Manifest", () => {
    const data = manifest();

    expect(data.name).toBe("SecondBrain — Life OS");
    expect(data.short_name).toBe("SecondBrain");
    expect(data.start_url).toBe("/");
    expect(data.scope).toBe("/");
    expect(data.display).toBe("standalone");
    expect(data.background_color).toBe("#09090b");
    expect(data.theme_color).toBe("#09090b");
    expect(Array.isArray(data.icons)).toBe(true);
    expect(data.icons?.length).toBeGreaterThanOrEqual(3);

    const srcs = data.icons?.map((icon) => icon.src) ?? [];
    expect(srcs).toContain("/icons/icon-192.png");
    expect(srcs).toContain("/icons/icon-512.png");
    expect(srcs).toContain("/icons/icon-maskable-512.png");

    const maskable = data.icons?.find(
      (icon) => icon.src === "/icons/icon-maskable-512.png",
    );
    expect(maskable?.sizes).toBe("512x512");
    expect(maskable?.type).toBe("image/png");
    expect(maskable?.purpose).toBe("maskable");
  });
});

describe("PWA PNG Icons (public/icons/*)", () => {
  const expectedIcons = [
    { file: "icon-192.png", width: 192, height: 192 },
    { file: "icon-512.png", width: 512, height: 512 },
    { file: "icon-maskable-512.png", width: 512, height: 512 },
    { file: "apple-touch-icon.png", width: 180, height: 180 },
  ];

  for (const { file, width, height } of expectedIcons) {
    it(`has a valid ${width}x${height} PNG at public/icons/${file}`, () => {
      const fullPath = path.join(ICONS_DIR, file);
      expect(fs.existsSync(fullPath)).toBe(true);

      const bytes = fs.readFileSync(fullPath);
      expect(bytes.length).toBeGreaterThan(500);

      // Verify 8-byte PNG magic signature
      expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

      // Verify IHDR chunk header and exact width/height
      const chunkType = bytes.subarray(12, 16).toString("ascii");
      expect(chunkType).toBe("IHDR");

      const parsedWidth = bytes.readUInt32BE(16);
      const parsedHeight = bytes.readUInt32BE(20);
      expect(parsedWidth).toBe(width);
      expect(parsedHeight).toBe(height);
    });
  }
});

describe("Service Worker (public/sw.js)", () => {
  const swSource = fs.readFileSync(SW_PATH, "utf8");

  it("parses cleanly as valid JavaScript syntax", () => {
    expect(() => new Function(swSource)).not.toThrow();
  });

  it("enforces security invariants: Network-Only /api/*, non-GET guard, /offline fallback", () => {
    expect(swSource).toContain('"/api/"');
    expect(swSource).toContain('"/offline"');
    expect(swSource).toContain('request.method !== "GET"');
    expect(swSource).toContain("url.origin !== self.location.origin");
    expect(swSource).toContain('url.pathname.startsWith("/api/")');
    expect(swSource).toContain('request.mode === "navigate"');
    expect(swSource).toContain("self.skipWaiting()");
    expect(swSource).toContain("self.clients.claim()");
  });

  it("never precaches any /api/ route", () => {
    const precacheMatch = swSource.match(/PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/);
    expect(precacheMatch).not.toBeNull();
    expect(precacheMatch?.[1]).not.toContain("/api/");
  });
});

describe("Next.js PWA & Standalone Config (next.config.ts)", () => {
  it("enables standalone output for container deployments", () => {
    expect(nextConfig.output).toBe("standalone");
  });

  it("configures strict no-cache and scope headers for /sw.js", async () => {
    expect(typeof nextConfig.headers).toBe("function");
    const headerRules = (await nextConfig.headers?.()) ?? [];
    const swRule = headerRules.find((rule) => rule.source === "/sw.js");
    expect(swRule).toBeDefined();

    const headerMap = new Map(
      (swRule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]),
    );

    expect(headerMap.get("content-type")).toMatch(/javascript/i);
    expect(headerMap.get("cache-control")).toMatch(/no-cache/i);
    expect(headerMap.get("cache-control")).toMatch(/no-store/i);
    expect(headerMap.get("service-worker-allowed")).toBe("/");
  });
});
