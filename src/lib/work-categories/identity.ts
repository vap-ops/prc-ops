// Spec 277 U1 — work-category VISUAL IDENTITY SSOT (letter · color · icon),
// parallel to status-colors.ts + status-icons.ts. One identity per GLOBAL
// work-category (W01–W09, spec 226). The maps are Record<WorkCategoryTopCode, …>
// so adding a top category is a TYPE error here — exactly the place to give it a
// letter/icon/colour (mirrors the status SSOTs' exhaustiveness).
//
// Colour lives as a globals.css token (--color-cat-w0x) consumed via the
// bg-cat-w0x / text-cat-w0x utility — NOT a raw Tailwind hue (design-doctrine).
// The literal class strings below are what Tailwind's source scan sees, so the
// utilities are emitted; never build them dynamically.

import type { LucideIcon } from "lucide-react";
import {
  Droplets,
  Frame,
  Hammer,
  PaintRoller,
  Signpost,
  Sofa,
  TreePine,
  Wind,
  Zap,
} from "lucide-react";

// The 9 firm-wide top categories. Subsections are 5-char codes (W0203) whose
// parent is the first 3 chars (spec 226 grain); they inherit the parent identity.
export const WORK_CATEGORY_TOP_CODES = [
  "W01",
  "W02",
  "W03",
  "W04",
  "W05",
  "W06",
  "W07",
  "W08",
  "W09",
] as const;

export type WorkCategoryTopCode = (typeof WORK_CATEGORY_TOP_CODES)[number];

// Operator-approved scheme (spec 277): letters from the English gloss, none in
// the OCR-confusable set (I/O/L/1/0); HVAC = C (not V) so it can't read as W.
const LETTER: Record<WorkCategoryTopCode, string> = {
  W01: "P", // Preparation & Demolition
  W02: "S", // Structural
  W03: "A", // Architectural
  W04: "W", // Water (Plumbing & Sanitary)
  W05: "E", // Electrical & Communication
  W06: "C", // air-Conditioning / HVAC
  W07: "G", // siGnage
  W08: "X", // eXternal & site
  W09: "F", // Furniture / fixtures
};

// All verified present in lucide-react.
const ICON: Record<WorkCategoryTopCode, LucideIcon> = {
  W01: Hammer,
  W02: Frame,
  W03: PaintRoller,
  W04: Droplets,
  W05: Zap,
  W06: Wind,
  W07: Signpost,
  W08: TreePine,
  W09: Sofa,
};

// Literal utility strings (Tailwind-scannable) → --color-cat-w0x tokens.
const TILE_CLASS: Record<WorkCategoryTopCode, string> = {
  W01: "bg-cat-w01",
  W02: "bg-cat-w02",
  W03: "bg-cat-w03",
  W04: "bg-cat-w04",
  W05: "bg-cat-w05",
  W06: "bg-cat-w06",
  W07: "bg-cat-w07",
  W08: "bg-cat-w08",
  W09: "bg-cat-w09",
};

const ACCENT_CLASS: Record<WorkCategoryTopCode, string> = {
  W01: "text-cat-w01",
  W02: "text-cat-w02",
  W03: "text-cat-w03",
  W04: "text-cat-w04",
  W05: "text-cat-w05",
  W06: "text-cat-w06",
  W07: "text-cat-w07",
  W08: "text-cat-w08",
  W09: "text-cat-w09",
};

export interface WorkCategoryIdentity {
  /** The resolved top code (W01–W09), even when a subsection code was passed. */
  code: WorkCategoryTopCode;
  /** Single recognition letter (P S A W E C G X F). */
  letter: string;
  /** lucide glyph for the category. */
  icon: LucideIcon;
  /** Solid tile background utility (white ink) — e.g. "bg-cat-w05". */
  tileClass: string;
  /** Accent text/icon utility — e.g. "text-cat-w05". */
  accentClass: string;
}

export function isWorkCategoryTopCode(code: string): code is WorkCategoryTopCode {
  return (WORK_CATEGORY_TOP_CODES as readonly string[]).includes(code);
}

// Resolve any work_categories.code to its identity: a 3-char top (W02) maps to
// itself; a 5-char subsection (W0203) maps to its parent top (left(code,3),
// spec 226). Blank / unknown / malformed → null (uncategorised).
export function workCategoryIdentity(code: string | null | undefined): WorkCategoryIdentity | null {
  if (!code) return null;
  const top = code.trim().slice(0, 3).toUpperCase();
  if (!isWorkCategoryTopCode(top)) return null;
  return {
    code: top,
    letter: LETTER[top],
    icon: ICON[top],
    tileClass: TILE_CLASS[top],
    accentClass: ACCENT_CLASS[top],
  };
}
