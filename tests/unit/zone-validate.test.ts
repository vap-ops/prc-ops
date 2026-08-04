// Spec 392 U2a — the client-side mirror of the DB's zone rules.
//
// The DB is the authority (`project_zones_geometry_ok` + the code/name CHECKs);
// this module exists so the editor can refuse before the round-trip and say why
// in Thai. Every case below is written against the CHECK's actual behaviour,
// read live from `zone_geometry_ok` — a mirror that disagrees with its original
// is worse than no mirror, because it refuses work the DB would have accepted.

import { describe, expect, it } from "vitest";
import {
  validateZoneCode,
  validateZoneName,
  validateZoneGeometry,
  ZONE_CODE_MAX,
  ZONE_NAME_MAX,
} from "@/lib/zones/validate-zone";

describe("validateZoneCode", () => {
  it("accepts a short code and trims it", () => {
    const result = validateZoneCode("  A  ");
    expect(result).toEqual({ ok: true, code: "A" });
  });

  it("refuses an empty code", () => {
    const result = validateZoneCode("   ");
    expect(result.ok).toBe(false);
  });

  it("refuses a code past the column limit", () => {
    const result = validateZoneCode("Z".repeat(ZONE_CODE_MAX + 1));
    expect(result.ok).toBe(false);
  });

  it("accepts a code exactly at the limit — the boundary the DB allows", () => {
    const result = validateZoneCode("Z".repeat(ZONE_CODE_MAX));
    expect(result.ok).toBe(true);
  });
});

describe("validateZoneName", () => {
  it("accepts a Thai name and trims it", () => {
    expect(validateZoneName(" พื้นลานด้านซ้าย ")).toEqual({
      ok: true,
      name: "พื้นลานด้านซ้าย",
    });
  });

  it("refuses an empty name", () => {
    expect(validateZoneName("")).toEqual({ ok: false, error: expect.any(String) });
  });

  it("refuses a name past the column limit", () => {
    expect(validateZoneName("ก".repeat(ZONE_NAME_MAX + 1)).ok).toBe(false);
  });
});

describe("validateZoneGeometry — box shapes", () => {
  it("accepts a rect wholly inside the unit box", () => {
    expect(validateZoneGeometry("rect", { x: 0.05, y: 0.1, w: 0.4, h: 0.5 }).ok).toBe(true);
  });

  it("accepts a rect that exactly fills the box", () => {
    expect(validateZoneGeometry("rect", { x: 0, y: 0, w: 1, h: 1 }).ok).toBe(true);
  });

  it("refuses a rect running past the right edge", () => {
    expect(validateZoneGeometry("rect", { x: 0.8, y: 0.1, w: 0.5, h: 0.2 }).ok).toBe(false);
  });

  it("refuses a rect running past the bottom edge", () => {
    expect(validateZoneGeometry("rect", { x: 0.1, y: 0.9, w: 0.2, h: 0.2 }).ok).toBe(false);
  });

  it("refuses a zero-width rect — the DB requires w > 0", () => {
    expect(validateZoneGeometry("rect", { x: 0.1, y: 0.1, w: 0, h: 0.2 }).ok).toBe(false);
  });

  it("refuses a negative origin", () => {
    expect(validateZoneGeometry("rect", { x: -0.1, y: 0.1, w: 0.2, h: 0.2 }).ok).toBe(false);
  });

  it("applies the same rule to ellipse and rounded_rect", () => {
    expect(validateZoneGeometry("ellipse", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }).ok).toBe(true);
    expect(validateZoneGeometry("rounded_rect", { x: 0.9, y: 0.1, w: 0.2, h: 0.2 }).ok).toBe(false);
  });

  it("refuses box geometry carrying polygon points — the DB rejects the mixed form", () => {
    expect(
      validateZoneGeometry("rect", {
        x: 0.1,
        y: 0.1,
        w: 0.2,
        h: 0.2,
        points: [[0.1, 0.1]],
      } as never).ok,
    ).toBe(false);
  });
});

describe("validateZoneGeometry — polygon", () => {
  it("accepts a triangle inside the unit box", () => {
    expect(
      validateZoneGeometry("polygon", {
        points: [
          [0.1, 0.1],
          [0.5, 0.2],
          [0.4, 0.6],
        ],
      }).ok,
    ).toBe(true);
  });

  it("refuses fewer than three points — two points are a line, not a zone", () => {
    expect(
      validateZoneGeometry("polygon", {
        points: [
          [0.1, 0.1],
          [0.5, 0.2],
        ],
      }).ok,
    ).toBe(false);
  });

  it("refuses a point outside [0,1]", () => {
    expect(
      validateZoneGeometry("polygon", {
        points: [
          [0.1, 0.1],
          [0.5, -0.2],
          [0.4, 0.6],
        ],
      }).ok,
    ).toBe(false);
  });

  it("refuses polygon geometry carrying box keys", () => {
    expect(validateZoneGeometry("polygon", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } as never).ok).toBe(
      false,
    );
  });

  it("refuses more points than the DB cap", () => {
    const points = Array.from({ length: 201 }, (_, i) => [i / 400, 0.5] as [number, number]);
    expect(validateZoneGeometry("polygon", { points }).ok).toBe(false);
  });
});
