// Spec 392 U2a — the client-side mirror of the DB's zone rules.
//
// The DB is the AUTHORITY: `project_zones_geometry_ok` (via the IMMUTABLE
// `zone_geometry_ok`) plus the code/name CHECKs decide what may exist. This
// module exists only so the editor can refuse before the round-trip and say
// why in Thai — the same division of labour `validate-markup.ts` has with the
// `photo_markups` CHECKs.
//
// ⚠️ A mirror must never be STRICTER than its original: refusing work the DB
// would have accepted is a bug the DB can never surface. Where floating-point
// makes the two disagree, this file errs toward accepting (see EPSILON).

export const ZONE_CODE_MAX = 20;
export const ZONE_NAME_MAX = 120;
export const ZONE_POLYGON_MIN_POINTS = 3;
export const ZONE_POLYGON_MAX_POINTS = 200;

// `x + w <= 1` is exact in Postgres (jsonb numbers become `numeric`) but not in
// IEEE754 — 0.1 + 0.9 can land a hair above 1. The DB would accept that rect;
// so must we.
const EPSILON = 1e-9;

export type ZoneShape = "rect" | "rounded_rect" | "ellipse" | "polygon";

export interface BoxGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PolygonGeometry {
  points: ReadonlyArray<readonly [number, number]>;
}

export type ZoneGeometry = BoxGeometry | PolygonGeometry;

export type ValidateResult<K extends string, V> =
  | ({ ok: true } & Record<K, V>)
  | { ok: false; error: string };

function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateZoneCode(input: string): ValidateResult<"code", string> {
  const code = input.trim();
  if (code.length === 0) return { ok: false, error: "ต้องระบุรหัสโซน" };
  if (code.length > ZONE_CODE_MAX)
    return { ok: false, error: `รหัสโซนต้องไม่เกิน ${ZONE_CODE_MAX} ตัวอักษร` };
  return { ok: true, code };
}

export function validateZoneName(input: string): ValidateResult<"name", string> {
  const name = input.trim();
  if (name.length === 0) return { ok: false, error: "ต้องระบุชื่อโซน" };
  if (name.length > ZONE_NAME_MAX)
    return { ok: false, error: `ชื่อโซนต้องไม่เกิน ${ZONE_NAME_MAX} ตัวอักษร` };
  return { ok: true, name };
}

function hasKey(geometry: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(geometry, key);
}

function validatePolygon(geometry: object): ValidateResult<"geometry", ZoneGeometry> {
  // The DB rejects the mixed form outright: a shape change that left the old
  // keys behind would otherwise persist geometry the renderer cannot draw.
  if (["x", "y", "w", "h"].some((k) => hasKey(geometry, k)))
    return { ok: false, error: "รูปทรงหลายเหลี่ยมต้องมีเฉพาะพิกัดมุม" };

  const points = (geometry as { points?: unknown }).points;
  if (!Array.isArray(points)) return { ok: false, error: "ต้องระบุพิกัดมุมของโซน" };
  if (points.length < ZONE_POLYGON_MIN_POINTS)
    return { ok: false, error: `โซนต้องมีอย่างน้อย ${ZONE_POLYGON_MIN_POINTS} มุม` };
  if (points.length > ZONE_POLYGON_MAX_POINTS)
    return { ok: false, error: `โซนมีมุมได้ไม่เกิน ${ZONE_POLYGON_MAX_POINTS} จุด` };

  const allInside = points.every(
    (point) =>
      Array.isArray(point) && point.length === 2 && isFraction(point[0]) && isFraction(point[1]),
  );
  if (!allInside) return { ok: false, error: "พิกัดมุมต้องอยู่ในกรอบผัง" };

  return { ok: true, geometry: geometry as PolygonGeometry };
}

function validateBox(geometry: object): ValidateResult<"geometry", ZoneGeometry> {
  if (hasKey(geometry, "points"))
    return { ok: false, error: "รูปทรงนี้ต้องระบุเป็นกรอบ ไม่ใช่พิกัดมุม" };

  const { x, y, w, h } = geometry as Partial<BoxGeometry>;
  if (!isFraction(x) || !isFraction(y)) return { ok: false, error: "ตำแหน่งโซนต้องอยู่ในกรอบผัง" };
  if (typeof w !== "number" || typeof h !== "number" || !Number.isFinite(w) || !Number.isFinite(h))
    return { ok: false, error: "ขนาดโซนไม่ถูกต้อง" };
  if (w <= 0 || h <= 0) return { ok: false, error: "ขนาดโซนต้องมากกว่าศูนย์" };
  if (x + w > 1 + EPSILON || y + h > 1 + EPSILON)
    return { ok: false, error: "โซนต้องอยู่ภายในกรอบผัง" };

  return { ok: true, geometry: geometry as BoxGeometry };
}

export function validateZoneGeometry(
  shape: ZoneShape,
  geometry: ZoneGeometry,
): ValidateResult<"geometry", ZoneGeometry> {
  if (typeof geometry !== "object" || geometry === null)
    return { ok: false, error: "รูปโซนไม่ถูกต้อง" };
  return shape === "polygon" ? validatePolygon(geometry) : validateBox(geometry);
}
