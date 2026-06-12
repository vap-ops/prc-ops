// Spec 51 — pure validator behind addPhotoMarkup. The DB CHECKs are the
// security authority; these pin the UX-side rules: at least one payload,
// comment trim/cap, strokes bounded and normalized to [0,1].

import { describe, expect, it } from "vitest";
import { validatePhotoMarkup } from "@/lib/photos/validate-markup";

const STROKE = {
  points: [
    [0.1, 0.1],
    [0.5, 0.5],
    [0.9, 0.2],
  ],
};

describe("validatePhotoMarkup (spec 51)", () => {
  it("accepts strokes plus a trimmed comment", () => {
    const r = validatePhotoMarkup({ strokes: [STROKE], comment: "  ตรงนี้ร้าว  " });
    expect(r).toEqual({
      ok: true,
      value: { strokes: [STROKE], comment: "ตรงนี้ร้าว" },
    });
  });

  it("accepts comment-only (strokes null) and strokes-only (comment null)", () => {
    const commentOnly = validatePhotoMarkup({ strokes: null, comment: "ดูจุดนี้" });
    expect(commentOnly.ok).toBe(true);
    if (commentOnly.ok) expect(commentOnly.value.strokes).toBeNull();
    const strokesOnly = validatePhotoMarkup({ strokes: [STROKE], comment: "   " });
    expect(strokesOnly.ok).toBe(true);
    if (strokesOnly.ok) expect(strokesOnly.value.comment).toBeNull();
  });

  it("rejects an empty markup — no strokes and no comment", () => {
    for (const input of [
      { strokes: null, comment: null },
      { strokes: [], comment: "  " },
    ]) {
      expect(validatePhotoMarkup(input)).toEqual({
        ok: false,
        error: "ต้องมีเส้นวาดหรือความเห็น",
      });
    }
  });

  it("rejects a comment over 1000 characters", () => {
    expect(validatePhotoMarkup({ strokes: null, comment: "ก".repeat(1001) })).toEqual({
      ok: false,
      error: "ความเห็นต้องไม่เกิน 1000 ตัวอักษร",
    });
  });

  it("rejects out-of-range, non-finite, and degenerate strokes", () => {
    const bad = [
      [{ points: [[0.1, 0.1]] }], // single point — not a line
      [
        {
          points: [
            [-0.1, 0.5],
            [0.5, 0.5],
          ],
        },
      ], // out of range
      [
        {
          points: [
            [Number.NaN, 0.5],
            [0.5, 0.5],
          ],
        },
      ], // non-finite
    ];
    for (const strokes of bad) {
      expect(validatePhotoMarkup({ strokes, comment: null })).toEqual({
        ok: false,
        error: "เส้นวาดไม่ถูกต้อง",
      });
    }
  });

  it("rejects more than 50 strokes and strokes over 500 points", () => {
    const many = Array.from({ length: 51 }, () => STROKE);
    expect(validatePhotoMarkup({ strokes: many, comment: null })).toEqual({
      ok: false,
      error: "เส้นวาดไม่ถูกต้อง",
    });
    const long = [{ points: Array.from({ length: 501 }, (_, i) => [i / 501, 0.5]) }];
    expect(validatePhotoMarkup({ strokes: long, comment: null })).toEqual({
      ok: false,
      error: "เส้นวาดไม่ถูกต้อง",
    });
  });
});
