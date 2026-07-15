// UI-term SSOT guard (docs: ui-term-consistency; audit 2026-06 rank 11,
// `ssot-literal-bypass`). A user-facing term that labels.ts single-sources
// must be consumed via its exported constant — re-hardcoding the literal
// elsewhere is exactly the drift the SSOT exists to prevent (a rename in
// labels.ts would silently miss the stray copy).
//
// The scan matches the EXACT quoted literal (`"<term>"`), so longer strings
// that merely start with the term (e.g. "รับเข้าสต๊อกไม่สำเร็จ…") and prose
// comments that mention it stay legal.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");
const LABELS = join("lib", "i18n", "labels.ts");

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkSrc(p));
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const sources = walkSrc(SRC).map((abs) => ({
  rel: relative(SRC, abs),
  text: readFileSync(abs, "utf8"),
}));

// Terms already single-sourced in labels.ts whose literal has been caught
// re-hardcoded before. Extend this list when a new SSOT term earns a guard.
const SINGLE_SOURCED_TERMS = [
  "ผู้รับเหมาช่วง", // SUBCONTRACTOR_LABEL
  "รับเข้าสต๊อก", // STORE_RECEIVE_LABEL
  "ข้อมูลของฉัน", // MY_INFO_LABEL (spec 321 U1 — the canonical profile-edit door)
  "โปรไฟล์", // PROFILE_LABEL (spec 321 U1 — the /profile card name)
];

describe("labels.ts single-sourced terms (SSOT)", () => {
  for (const term of SINGLE_SOURCED_TERMS) {
    it(`"${term}" appears as an exact string literal only in labels.ts`, () => {
      const literal = `"${term}"`;
      const offenders = sources
        .filter((f) => f.rel !== LABELS && f.text.includes(literal))
        .map((f) => f.rel);
      expect(offenders).toEqual([]);
    });
  }
});
