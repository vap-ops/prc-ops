// Spec 392 U2b — the arithmetic between Konva's stage and the database.
//
// The engine never sees the database (spec §3): geometry persists as fractions
// of the map box, so swapping the background moves nothing and a cloned map
// lands on a differently-photographed site. Konva, meanwhile, only speaks
// pixels on a stage whose size depends on the viewport. This module is the
// whole of that translation, plus the two rules a pointer can violate —
// dragging a zone out of the map, and snapping it to a grid.
//
// It lives outside the island on purpose: jsdom has no layout engine, so
// nothing asserted through a rendered canvas is real. Everything decidable
// without pixels is decided here, where a test can reach it.
//
// ⚠️ Every exit point must satisfy `validateZoneGeometry`, which mirrors the
// DB's `zone_geometry_ok`. A clamp that can emit an invalid box shows up as a
// refused save at the END of a drag, with the manager's work already gone.

import type { BoxGeometry, PolygonGeometry } from "@/lib/zones/validate-zone";

export interface StageSize {
  width: number;
  height: number;
}

/** Konva's own rect shape: pixel origin plus pixel size. */
export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 5% of the map. Coarse on purpose — a site plan is not graph paper. */
export const ZONE_SNAP_STEP = 0.05;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function toFraction(pixels: number, extent: number): number {
  // A Konva stage measures 0×0 for one frame before layout settles, and a
  // division by it would put NaN into `geometry` — a 22023 the user cannot act
  // on, raised at save time rather than at drag time.
  if (!Number.isFinite(extent) || extent <= 0) return 0;
  return finite(pixels) / extent;
}

export function boxToPixels(box: BoxGeometry, stage: StageSize): PixelBox {
  return {
    x: box.x * stage.width,
    y: box.y * stage.height,
    width: box.w * stage.width,
    height: box.h * stage.height,
  };
}

export function pixelsToBox(px: PixelBox, stage: StageSize): BoxGeometry {
  return {
    x: toFraction(px.x, stage.width),
    y: toFraction(px.y, stage.height),
    w: toFraction(px.width, stage.width),
    h: toFraction(px.height, stage.height),
  };
}

/** Konva takes polygon points as one flat `[x, y, x, y, …]` array. */
export function polygonToPixels(polygon: PolygonGeometry, stage: StageSize): number[] {
  const flat: number[] = [];
  for (const [x, y] of polygon.points) {
    flat.push(x * stage.width, y * stage.height);
  }
  return flat;
}

export function pixelsToPolygon(flat: readonly number[], stage: StageSize): PolygonGeometry {
  const points: Array<readonly [number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    points.push([
      clampUnit(toFraction(flat[i] as number, stage.width)),
      clampUnit(toFraction(flat[i + 1] as number, stage.height)),
    ]);
  }
  return { points };
}

function clampUnit(value: number): number {
  const n = finite(value);
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function snapFraction(value: number, enabled: boolean, step = ZONE_SNAP_STEP): number {
  if (!enabled || step <= 0) return value;
  return Math.round(finite(value) / step) * step;
}

/**
 * Snap a box, then put it back inside the map.
 *
 * Order matters twice. Snapping a SIZE naively can round it to zero, which the
 * DB refuses outright (`w > 0`), so a size floors at one grid step. And
 * snapping an ORIGIN can push a box that was inside over the edge, so the
 * clamp runs last — snapping happens inside the clamp, never after it.
 */
export function snapBox(box: BoxGeometry, enabled: boolean, step = ZONE_SNAP_STEP): BoxGeometry {
  if (!enabled) return clampBoxToUnit(box);
  return clampBoxToUnit({
    x: snapFraction(box.x, true, step),
    y: snapFraction(box.y, true, step),
    w: Math.max(step, snapFraction(box.w, true, step)),
    h: Math.max(step, snapFraction(box.h, true, step)),
  });
}

export function snapPolygon(
  polygon: PolygonGeometry,
  enabled: boolean,
  step = ZONE_SNAP_STEP,
): PolygonGeometry {
  if (!enabled) return { points: polygon.points.map(([x, y]) => [clampUnit(x), clampUnit(y)]) };
  return {
    points: polygon.points.map(([x, y]) => [
      clampUnit(snapFraction(x, true, step)),
      clampUnit(snapFraction(y, true, step)),
    ]),
  };
}

/**
 * Put a box back inside the unit map.
 *
 * ⭐ Overflow SLIDES the box back rather than shrinking it: a manager dragging
 * a zone past the edge meant to move it, and a silent resize would change the
 * zone's meaning without ever saying so. Only a box larger than the map itself
 * is shrunk, because nothing else can be done with it.
 */
/**
 * The four corners of a box, in draw order.
 *
 * Converting a box to a polygon starts here because it is the only starting
 * shape that leaves the zone exactly where the manager put it — any other seed
 * would move the zone as a side effect of changing its shape.
 */
export function boxToCorners(box: BoxGeometry): ReadonlyArray<readonly [number, number]> {
  return [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
}

/**
 * A polygon collapsed to its bounding box.
 *
 * Lossy, and the caller is responsible for saying so before it happens — every
 * vertex past the four corners is gone. Degenerate input (all points collinear)
 * yields a zero-thickness box, which the DB refuses outright, so the clamp's
 * one-grid-step floor applies here too rather than at the call site.
 */
export function cornersToBox(points: ReadonlyArray<readonly [number, number]>): BoxGeometry {
  if (points.length === 0) return clampBoxToUnit({ x: 0, y: 0, w: 0, h: 0 });
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return clampBoxToUnit({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
}

export function clampBoxToUnit(box: BoxGeometry): BoxGeometry {
  // A zero or non-finite size cannot be slid anywhere useful. One grid step is
  // the smallest thing the toolbar can produce, so it is the floor here too.
  const w = Math.min(1, Math.max(ZONE_SNAP_STEP, finite(box.w, ZONE_SNAP_STEP)));
  const h = Math.min(1, Math.max(ZONE_SNAP_STEP, finite(box.h, ZONE_SNAP_STEP)));
  const x = Math.min(Math.max(0, finite(box.x)), 1 - w);
  const y = Math.min(Math.max(0, finite(box.y)), 1 - h);
  return { x, y, w, h };
}
