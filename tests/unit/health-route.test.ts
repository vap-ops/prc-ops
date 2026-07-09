// Spec 287 — `/api/health` liveness probe. A dependency-free 200 that an uptime
// monitor can poll and that reports the live build version (closes part of GA
// gap G5: nothing external can currently tell whether the app is up).

import { describe, expect, it } from "vitest";

import pkg from "../../package.json";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with status ok and the running app version", async () => {
    const res = await GET();

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe(pkg.version);
    expect(typeof body.timestamp).toBe("string");
    // timestamp is a real ISO instant, not a placeholder
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
