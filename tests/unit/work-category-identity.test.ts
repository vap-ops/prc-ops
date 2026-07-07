// Writing failing test first.
//
// Spec 277 U1 — the work-category identity SSOT. One letter / icon / color per
// global work-category (W01–W09, spec 226), mirroring status-colors + status-icons.
// The resolver must accept both a 3-char top code and a 5-char subsection code
// (spec 226 grain: a subsection's parent is left(code,3)), and reject anything else.

import { describe, expect, it } from "vitest";
import {
  WORK_CATEGORY_TOP_CODES,
  isWorkCategoryTopCode,
  workCategoryIdentity,
  type WorkCategoryTopCode,
} from "@/lib/work-categories/identity";

// The operator-approved scheme (spec 277): P S A W E C G X F on W01..W09.
const EXPECTED_LETTER: Record<WorkCategoryTopCode, string> = {
  W01: "P",
  W02: "S",
  W03: "A",
  W04: "W",
  W05: "E",
  W06: "C",
  W07: "G",
  W08: "X",
  W09: "F",
};

describe("work-category identity SSOT (spec 277 U1)", () => {
  it("covers exactly the 9 global top categories", () => {
    expect([...WORK_CATEGORY_TOP_CODES]).toEqual([
      "W01",
      "W02",
      "W03",
      "W04",
      "W05",
      "W06",
      "W07",
      "W08",
      "W09",
    ]);
  });

  it("maps each top code to its approved letter", () => {
    for (const code of WORK_CATEGORY_TOP_CODES) {
      expect(workCategoryIdentity(code)?.letter).toBe(EXPECTED_LETTER[code]);
    }
  });

  it("assigns a distinct letter to every category", () => {
    const letters = WORK_CATEGORY_TOP_CODES.map((c) => workCategoryIdentity(c)!.letter);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it("never uses an OCR-confusable letter (I/O/L/1/0)", () => {
    for (const code of WORK_CATEGORY_TOP_CODES) {
      expect(workCategoryIdentity(code)!.letter).not.toMatch(/[IOL10]/);
    }
  });

  it("exposes a token color class and an icon for every category", () => {
    for (const code of WORK_CATEGORY_TOP_CODES) {
      const id = workCategoryIdentity(code)!;
      expect(id.tileClass).toBe(`bg-${code.toLowerCase().replace("w", "cat-w")}`);
      expect(id.accentClass).toBe(`text-${code.toLowerCase().replace("w", "cat-w")}`);
      // icon is a lucide component (function/forwardRef object)
      expect(["function", "object"]).toContain(typeof id.icon);
    }
  });

  it("resolves a 5-char subsection code to its parent top identity", () => {
    // W0203 (Pedestals & Columns) → parent W02 (Structural), letter S.
    expect(workCategoryIdentity("W0203")).toMatchObject({ code: "W02", letter: "S" });
    expect(workCategoryIdentity("W0901")).toMatchObject({ code: "W09", letter: "F" });
    // a top code passed whole resolves to itself
    expect(workCategoryIdentity("W05")).toMatchObject({ code: "W05", letter: "E" });
  });

  it("returns null for blank, unknown, or malformed codes", () => {
    expect(workCategoryIdentity(null)).toBeNull();
    expect(workCategoryIdentity(undefined)).toBeNull();
    expect(workCategoryIdentity("")).toBeNull();
    expect(workCategoryIdentity("Z99")).toBeNull();
    expect(workCategoryIdentity("W99")).toBeNull();
    expect(workCategoryIdentity("nonsense")).toBeNull();
  });

  it("isWorkCategoryTopCode narrows only the 9 valid codes", () => {
    expect(isWorkCategoryTopCode("W01")).toBe(true);
    expect(isWorkCategoryTopCode("W09")).toBe(true);
    expect(isWorkCategoryTopCode("W10")).toBe(false);
    expect(isWorkCategoryTopCode("W0203")).toBe(false);
  });
});
