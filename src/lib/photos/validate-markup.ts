// Spec 51 — pure validator behind addPhotoMarkup. The DB CHECKs are the
// security authority (tombstone shape, comment length, strokes is an
// array); this mirrors the UX rules so the lightbox can refuse before
// the round-trip. Strokes are normalized polylines: every coordinate in
// [0,1] relative to the displayed image box, so a markup renders
// identically on any screen.

export interface MarkupStroke {
  points: ReadonlyArray<readonly [number, number]>;
}

const MAX_STROKES = 50;
const MAX_POINTS_PER_STROKE = 500;
const MAX_COMMENT_LENGTH = 1000;

export type ValidatedPhotoMarkup = {
  strokes: MarkupStroke[] | null;
  comment: string | null;
};

export type ValidatePhotoMarkupResult =
  | { ok: true; value: ValidatedPhotoMarkup }
  | { ok: false; error: string };

function isNormalizedCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidStroke(stroke: unknown): stroke is MarkupStroke {
  if (typeof stroke !== "object" || stroke === null) return false;
  const points = (stroke as { points?: unknown }).points;
  if (!Array.isArray(points)) return false;
  // A line needs at least two points; the cap bounds payload size.
  if (points.length < 2 || points.length > MAX_POINTS_PER_STROKE) return false;
  return points.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 2 &&
      isNormalizedCoordinate(p[0]) &&
      isNormalizedCoordinate(p[1]),
  );
}

export function validatePhotoMarkup(input: {
  strokes?: ReadonlyArray<unknown> | null | undefined;
  comment?: string | null | undefined;
}): ValidatePhotoMarkupResult {
  const commentRaw = input.comment?.trim() ?? "";
  if (commentRaw.length > MAX_COMMENT_LENGTH) {
    return { ok: false, error: "ความเห็นต้องไม่เกิน 1000 ตัวอักษร" };
  }
  const comment = commentRaw.length > 0 ? commentRaw : null;

  let strokes: MarkupStroke[] | null = null;
  if (input.strokes !== undefined && input.strokes !== null && input.strokes.length > 0) {
    if (input.strokes.length > MAX_STROKES || !input.strokes.every(isValidStroke)) {
      return { ok: false, error: "เส้นวาดไม่ถูกต้อง" };
    }
    strokes = input.strokes as MarkupStroke[];
  }

  // The DB tombstone-shape CHECK requires content rows to carry at
  // least one payload — mirror it here.
  if (strokes === null && comment === null) {
    return { ok: false, error: "ต้องมีเส้นวาดหรือความเห็น" };
  }

  return { ok: true, value: { strokes, comment } };
}
