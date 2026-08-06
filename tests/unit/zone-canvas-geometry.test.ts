// Spec 392 U2b — the pure half of the zone canvas.
//
// Konva speaks PIXELS on a stage whose size depends on the viewport; the DB
// stores FRACTIONS of the map box (U1's `[0,1]` CHECK, so a background swap
// moves nothing and a cloned map lands on a differently-photographed site).
// Every conversion, snap and clamp lives here rather than in the island,
// because jsdom has no layout engine — nothing that runs inside a canvas can
// be asserted, so the arithmetic has to be reachable without one.
//
// The load-bearing property: whatever a drag or resize produces, the result
// must be something `validateZoneGeometry` (and therefore the DB CHECK it
// mirrors) accepts. A clamp that can emit an invalid box would surface as a
// refused save at the end of a drag, with the user's work already lost.

import { describe, expect, it } from "vitest";
import { validateZoneGeometry } from "@/lib/zones/validate-zone";
import {
  ZONE_SNAP_STEP,
  boxToCorners,
  boxToPixels,
  clampBoxToUnit,
  cornersToBox,
  pixelsToBox,
  pixelsToPolygon,
  polygonLosesShape,
  polygonToPixels,
  snapBox,
  snapFraction,
  snapPolygon,
} from "@/lib/zones/canvas-geometry";

const STAGE = { width: 800, height: 500 };

describe("fraction ↔ pixel conversion", () => {
  it("maps a box onto the stage and back without drift", () => {
    const box = { x: 0.25, y: 0.4, w: 0.5, h: 0.2 };
    const px = boxToPixels(box, STAGE);
    expect(px).toEqual({ x: 200, y: 200, width: 400, height: 100 });
    expect(pixelsToBox(px, STAGE)).toEqual(box);
  });

  it("maps polygon points to Konva's flat pixel array and back", () => {
    const poly = {
      points: [
        [0, 0],
        [0.5, 0],
        [0.5, 1],
      ] as ReadonlyArray<readonly [number, number]>,
    };
    expect(polygonToPixels(poly, STAGE)).toEqual([0, 0, 400, 0, 400, 500]);
    expect(pixelsToPolygon([0, 0, 400, 0, 400, 500], STAGE)).toEqual(poly);
  });

  it("survives a stage of zero size rather than emitting NaN", () => {
    // A Konva stage measures 0×0 for one frame before layout settles. A NaN
    // reaching `geometry` is a 22023 the user cannot act on.
    expect(pixelsToBox({ x: 10, y: 10, width: 10, height: 10 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  });
});

describe("snapping", () => {
  it("is off unless the manager turns it on", () => {
    expect(snapFraction(0.123456, false)).toBe(0.123456);
  });

  it("rounds to the grid when on", () => {
    expect(snapFraction(0.123456, true)).toBeCloseTo(0.1, 10);
    expect(snapFraction(0.17, true)).toBeCloseTo(0.15, 10);
    expect(snapFraction(0.18, true)).toBeCloseTo(0.2, 10);
    expect(ZONE_SNAP_STEP).toBeGreaterThan(0);
  });

  it("never snaps a size down to zero — the DB refuses w <= 0", () => {
    // A sliver narrower than half a grid step rounds to 0 on a naive snap,
    // and `zone_geometry_ok` rejects that. The floor is one step.
    const snapped = snapBox({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }, true);
    expect(snapped.w).toBeCloseTo(ZONE_SNAP_STEP, 10);
    expect(snapped.h).toBeCloseTo(ZONE_SNAP_STEP, 10);
  });

  it("never snaps a box out of the map — snapping happens inside the clamp", () => {
    // 0.97 + 0.02 is inside; rounding the origin UP to 1.0 would put it out.
    const snapped = snapBox({ x: 0.97, y: 0.97, w: 0.02, h: 0.02 }, true);
    expect(validateZoneGeometry("rect", snapped).ok).toBe(true);
  });

  it("keeps every snapped polygon point inside the map", () => {
    const snapped = snapPolygon(
      {
        points: [
          [0.99, 0.99],
          [0.01, 0.5],
          [0.5, 0.02],
        ] as ReadonlyArray<readonly [number, number]>,
      },
      true,
    );
    expect(validateZoneGeometry("polygon", snapped).ok).toBe(true);
  });
});

describe("switching between a box and a polygon", () => {
  it("seeds a polygon from the box's own four corners, so the zone does not move", () => {
    const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.1 };
    expect(boxToCorners(box)).toEqual([
      [0.2, 0.3],
      [0.6000000000000001, 0.3],
      [0.6000000000000001, 0.4],
      [0.2, 0.4],
    ]);
  });

  it("round-trips a box through a polygon unchanged", () => {
    const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.1 };
    const back = cornersToBox(boxToCorners(box));
    expect(back.x).toBeCloseTo(box.x, 10);
    expect(back.y).toBeCloseTo(box.y, 10);
    expect(back.w).toBeCloseTo(box.w, 10);
    expect(back.h).toBeCloseTo(box.h, 10);
  });

  it("collapses a polygon to its bounding box", () => {
    const box = cornersToBox([
      [0.1, 0.2],
      [0.5, 0.1],
      [0.4, 0.6],
    ]);
    expect(box.x).toBeCloseTo(0.1, 10);
    expect(box.y).toBeCloseTo(0.1, 10);
    expect(box.w).toBeCloseTo(0.4, 10);
    expect(box.h).toBeCloseTo(0.5, 10);
  });

  it("gives a degenerate polygon a box the DB will accept", () => {
    // Three collinear points have zero height. `w > 0 and h > 0` is a DB CHECK,
    // so a naive bounding box would be refused at the end of a shape switch.
    const flat = cornersToBox([
      [0.2, 0.5],
      [0.5, 0.5],
      [0.8, 0.5],
    ]);
    expect(flat.h).toBeGreaterThan(0);
    expect(validateZoneGeometry("rect", flat).ok).toBe(true);

    const empty = cornersToBox([]);
    expect(validateZoneGeometry("rect", empty).ok).toBe(true);
  });
});

describe("polygonLosesShape — the honest test for a destructive collapse", () => {
  it("is TRUE for a four-vertex quad that is not a rectangle", () => {
    // ⭐ The case a point count cannot see, and the one a hand-drawn zone most
    // often is: same number of points, three corners moved.
    expect(
      polygonLosesShape([
        [0.1, 0.1],
        [0.5, 0.2],
        [0.6, 0.6],
        [0.05, 0.5],
      ]),
    ).toBe(true);
  });

  it("is FALSE for a polygon that already IS its bounding box", () => {
    expect(polygonLosesShape(boxToCorners({ x: 0.2, y: 0.3, w: 0.4, h: 0.1 }))).toBe(false);
  });

  it("is TRUE for a many-sided polygon", () => {
    expect(
      polygonLosesShape([
        [0.1, 0.1],
        [0.5, 0.1],
        [0.5, 0.4],
        [0.3, 0.5],
        [0.1, 0.4],
      ]),
    ).toBe(true);
  });

  it("is TRUE when a corner of the bounding box is unoccupied", () => {
    // A triangle spans the box but leaves one corner empty — collapsing it adds
    // area the zone never covered, which is a change like any other.
    expect(
      polygonLosesShape([
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
    ).toBe(true);
  });
});

describe("clampBoxToUnit", () => {
  it("keeps a dragged box inside the map by moving it, not by shrinking it", () => {
    // Dragging right past the edge must slide the box back — shrinking it
    // would silently resize a zone the manager only meant to move.
    expect(clampBoxToUnit({ x: 0.9, y: 0.1, w: 0.3, h: 0.2 })).toEqual({
      x: 0.7,
      y: 0.1,
      w: 0.3,
      h: 0.2,
    });
  });

  it("clamps a negative origin to the edge", () => {
    expect(clampBoxToUnit({ x: -0.2, y: -0.5, w: 0.3, h: 0.2 })).toEqual({
      x: 0,
      y: 0,
      w: 0.3,
      h: 0.2,
    });
  });

  it("shrinks only when the box is larger than the map itself", () => {
    expect(clampBoxToUnit({ x: -0.5, y: -0.5, w: 3, h: 2 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("emits a box the DB validator accepts for every hostile input", () => {
    // The property the whole module exists for. A failure here is a save that
    // dies at the end of a drag.
    const hostile = [
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 1, y: 1, w: 1, h: 1 },
      { x: -3, y: 4, w: -1, h: 0.5 },
      { x: 0.5, y: 0.5, w: Number.NaN, h: 0.2 },
      { x: Number.POSITIVE_INFINITY, y: 0.1, w: 0.2, h: 0.2 },
      { x: 0.999999, y: 0.999999, w: 0.000001, h: 0.000001 },
    ];
    for (const box of hostile) {
      expect(validateZoneGeometry("rect", clampBoxToUnit(box)).ok, JSON.stringify(box)).toBe(true);
    }
  });
});
