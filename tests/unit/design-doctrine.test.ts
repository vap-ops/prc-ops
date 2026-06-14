// Anti-drift doctrine — source-grep invariants that must hold across the
// app's tsx. Unit 1 (revised) updates these to match the Field-First
// output (test path (b): the design changed the output, so the assertions
// follow). Each invariant encodes a sun-readability / Thai / WP-identity
// rule that the redesign keeps.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

// Scan BOTH .ts and .tsx — colour/utility strings live in .ts too (e.g.
// lib/work-packages/action-bands.ts), so a .tsx-only walk would miss drift.
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
const allSrc = sources.map((f) => f.text).join("\n");

describe("design doctrine (Field-First)", () => {
  // Positive/done hue is emerald, encoded as the `done` token — never a
  // raw green-* literal anywhere in src.
  it("uses no green-* colour literals (emerald is the `done` token)", () => {
    const offenders = sources.filter((f) => /\b(?:bg|text|border|ring)-green-\d/.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  // Gloved-hands tap floor (spec 18/36): no sub-44px min-h-9 interactive
  // control anywhere in src. Restored — the reskin had dropped this pin,
  // letting the capture-sheet retry/remove buttons shrink to 36px.
  it("has no sub-44px min-h-9 control (the gloved-hands tap floor)", () => {
    const offenders = sources.filter((f) => /\bmin-h-9\b/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  // Canon: the phase progress bar's current segment is amber, never the
  // reserved link/active-nav blue. Restored from the spec-67 pin set.
  it("the phase progress bar never uses the reserved link blue", () => {
    const bar = readFileSync(join(SRC, "components/features/phase-progress-bar.tsx"), "utf8");
    expect(bar).not.toMatch(/bg-blue-700/);
  });

  // WP / subject identity stays full and primary: DETAIL_TITLE carries an
  // explicit leading- class (Thai tone-mark spacing) and never truncates.
  it("DETAIL_TITLE is display-tier, line-controlled, never truncated", () => {
    const classes = readFileSync(join(SRC, "lib/ui/classes.ts"), "utf8");
    const match = classes.match(/DETAIL_TITLE\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    const value = match![1];
    expect(value).toContain("text-display");
    expect(value).toMatch(/\bleading-/);
    expect(value).not.toContain("truncate");
  });

  // Worklist + deliverable names wrap (line-clamp), never single-line
  // truncate (Thai clips mid-word — spec 57).
  it("the worklist row name clamps, never truncates", () => {
    const row = readFileSync(join(SRC, "components/features/worklist-row.tsx"), "utf8");
    expect(row).toMatch(/line-clamp-\d/);
    expect(row).not.toMatch(/\btruncate\b/);
  });

  // Action-blue (the link/active-nav hue) is EXCLUSIVE: the amber capture
  // action and the current-phase cue must not borrow it. The hero capture
  // button is the amber token, not bg-action / bg-fill.
  it("the capture hero is the amber token, not action-blue", () => {
    const classes = readFileSync(join(SRC, "lib/ui/classes.ts"), "utf8");
    const match = classes.match(/BUTTON_CAPTURE\s*=\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    const value = match![1];
    expect(value).toContain("bg-attn");
    expect(value).not.toContain("bg-action");
  });

  // The critical-path badge is RESERVED but defined: the slot exists in
  // source (style-pinned) even though isCritical is false for all WPs
  // today. Guards against the slot being dropped before the engine lands.
  it("reserves the critical-path badge slot", () => {
    const row = readFileSync(join(SRC, "components/features/worklist-row.tsx"), "utf8");
    expect(row).toContain("isCritical");
    expect(row).toContain("CRITICAL_BADGE");
  });

  // No window.confirm anywhere — destructive actions use the themed
  // ConfirmDialog (spec 18).
  it("uses no window.confirm in src", () => {
    // The doctrine bans the native window.confirm (destructive actions use
    // the themed ConfirmDialog — spec 18). A bare `confirm(` would also catch
    // the legit `function confirm()` helper in confirm-action-button.tsx, so
    // pin the actual offender: the global call form.
    expect(/\bwindow\.confirm\s*\(/.test(allSrc)).toBe(false);
  });

  // Tap targets: the capture shutter + hero bar hold the ≥44px floor (the
  // hero bar is h-16 = 64px; the shutter is h-26/w-26 = 104px).
  it("the capture hero bar is at least 44px tall", () => {
    const classes = readFileSync(join(SRC, "lib/ui/classes.ts"), "utf8");
    const match = classes.match(/BUTTON_CAPTURE\s*=\s*"([^"]+)"/);
    expect(match![1]).toMatch(/\bh-(?:1[1-9]|2\d)\b/);
  });
});
