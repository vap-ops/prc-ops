// Writing failing test first.
//
// Spec 306 U3a — toWorkerBadgeQrSvg renders a worker's muster check-in QR as an
// SVG string. Payload is the worker id (workers.id), the SAME opaque value the
// printed badge encodes (src/app/sa/crew/badges/page.tsx) so the muster scanner
// reads phone or paper identically.

import { describe, expect, it } from "vitest";

import { toWorkerBadgeQrSvg } from "@/lib/muster/badge-qr";

describe("toWorkerBadgeQrSvg", () => {
  it("returns a non-empty svg string for a worker id", async () => {
    const svg = await toWorkerBadgeQrSvg("11111111-1111-1111-1111-111111111111");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.length).toBeGreaterThan(0);
  });

  it("encodes different worker ids into different svgs (payload is the id)", async () => {
    const a = await toWorkerBadgeQrSvg("11111111-1111-1111-1111-111111111111");
    const b = await toWorkerBadgeQrSvg("22222222-2222-2222-2222-222222222222");
    expect(a).not.toEqual(b);
  });
});
