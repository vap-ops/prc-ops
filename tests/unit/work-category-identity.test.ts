// Writing failing test first.
//
// Spec 277 U1 — the work-category identity SSOT. One letter / icon / color per
// global work-category (W01–W11, spec 226), mirroring status-colors + status-icons.
// The resolver must accept both a 3-char top code and a 5-char subsection code
// (spec 226 grain: a subsection's parent is left(code,3)), and reject anything else.
//
// Spec 389 added W10 (งานอื่นๆ, prefix O) and W11 (งานระบบความปลอดภัย, prefix SIS)
// to work_categories. Until they were given an identity here, the 26 catalogue
// items riding those two categories rendered BARE chips — the resolver returned
// null and every consumer fell through to its uncategorised branch.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORK_CATEGORY_TOP_CODES,
  isWorkCategoryTopCode,
  workCategoryIdentity,
  type WorkCategoryTopCode,
} from "@/lib/work-categories/identity";

// The operator-approved scheme (spec 277): P S A W E C G X F on W01..W09, then
// M (Miscellaneous — "O" for Others is banned as OCR-confusable) and Y (safetY —
// "S" is taken by Structural), both following the established convention of
// pulling a distinctive letter out of the English gloss (siGnage→G, eXternal→X).
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
  W10: "M",
  W11: "Y",
};

describe("work-category identity SSOT (spec 277 U1)", () => {
  it("covers exactly the 11 global top categories", () => {
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
      "W10",
      "W11",
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
    // the two-digit codes are the ones a naive left(code,3) still handles, but
    // they must not collide with each other: W10/W11 differ in the 3rd char.
    expect(workCategoryIdentity("W1001")).toMatchObject({ code: "W10", letter: "M" });
    expect(workCategoryIdentity("W1101")).toMatchObject({ code: "W11", letter: "Y" });
  });

  it("returns null for blank, unknown, or malformed codes", () => {
    expect(workCategoryIdentity(null)).toBeNull();
    expect(workCategoryIdentity(undefined)).toBeNull();
    expect(workCategoryIdentity("")).toBeNull();
    expect(workCategoryIdentity("Z99")).toBeNull();
    expect(workCategoryIdentity("W99")).toBeNull();
    expect(workCategoryIdentity("W12")).toBeNull();
    expect(workCategoryIdentity("nonsense")).toBeNull();
  });

  it("isWorkCategoryTopCode narrows only the 11 valid codes", () => {
    expect(isWorkCategoryTopCode("W01")).toBe(true);
    expect(isWorkCategoryTopCode("W09")).toBe(true);
    expect(isWorkCategoryTopCode("W10")).toBe(true);
    expect(isWorkCategoryTopCode("W11")).toBe(true);
    expect(isWorkCategoryTopCode("W12")).toBe(false);
    expect(isWorkCategoryTopCode("W0203")).toBe(false);
  });

  // The colour half of the identity is a globals.css token, and Tailwind v4
  // emits NO CSS for an undefined one — a `bg-cat-w10` with no --color-cat-w10
  // renders an invisible chip that no render test can see. Pin the pairing here
  // rather than trusting the repo-wide phantom-token guard alone.
  it("every category's colour token is defined in globals.css", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    for (const code of WORK_CATEGORY_TOP_CODES) {
      expect(css).toContain(`--color-cat-${code.toLowerCase()}:`);
    }
  });

  it("assigns a distinct colour token to every category", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const values = WORK_CATEGORY_TOP_CODES.map((code) => {
      const m = css.match(new RegExp(`--color-cat-${code.toLowerCase()}:\\s*([^;]+);`));
      return m?.[1]?.trim();
    });
    expect(values.every(Boolean)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});
