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
    const bar = readFileSync(
      join(SRC, "components/features/work-packages/phase-progress-bar.tsx"),
      "utf8",
    );
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
    const row = readFileSync(join(SRC, "components/features/chrome/worklist-row.tsx"), "utf8");
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
    const row = readFileSync(join(SRC, "components/features/chrome/worklist-row.tsx"), "utf8");
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

  // Horizontal-overflow containment (the 2026-06-25 "page moves left-right"
  // bug class, feedback 887ab7d8). The page scroller is the ONLY place an
  // over-wide child can drag the whole page sideways, so the defense lives
  // there: every <main> in src must clip horizontal overflow, and <main> may
  // exist ONLY in the two shell primitives (so no route hand-rolls a scroller
  // that bypasses the guard — ui-conventions §5).
  it("every page scroller clips horizontal overflow (no left-right page scroll)", () => {
    const mains = sources.filter((f) => /<main\s+className/.test(f.text));
    expect(mains.map((f) => f.rel).sort()).toEqual([
      join("components", "features", "chrome", "page-shell.tsx"),
      join("components", "features", "chrome", "page-skeleton.tsx"),
    ]);
    for (const f of mains) {
      expect(f.text, `${f.rel} <main> must clip horizontal overflow`).toMatch(
        /overflow-x-clip|overflow-hidden/,
      );
    }
  });

  // Text-containment (the "text box overflows its container" bug class,
  // feedback fab7980b — "happens on a lot of pages, fix it for good"). A long
  // unbroken string (URL, code, hash, space-less Thai) must wrap INSIDE its
  // box, not burst it sideways. Distinct from the page-scroller guard above:
  // that stops the whole PAGE panning; this stops content overrunning a CARD.
  // The systemic net is a base-layer default — body carries overflow-wrap, so
  // every descendant wraps unless it explicitly opts out — rather than a
  // per-component patch that the next new surface forgets.
  it("body sets a default overflow-wrap so long strings wrap inside containers", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const body = css.match(/\bbody\s*\{[^}]*\}/);
    expect(body, "body base rule not found in globals.css").not.toBeNull();
    expect(body![0], "body must default overflow-wrap (break-word|anywhere)").toMatch(
      /overflow-wrap:\s*(?:break-word|anywhere)/,
    );
  });

  // The shared detail-header action row (back chip + gear/reports/store chips +
  // refresh) must WRAP, never sit in a fixed non-wrapping row — on a narrow
  // phone a packed chip set would otherwise be clipped by the page scroller's
  // overflow-x-clip (feedback eee78c24 "menu up top is packed").
  it("the detail-header action row wraps rather than clipping its chips", () => {
    const header = readFileSync(join(SRC, "components/features/chrome/detail-header.tsx"), "utf8");
    // The {actions}+refresh cluster is the second flex child of the top row.
    const i = header.indexOf("{actions}");
    expect(i, "actions slot not found").toBeGreaterThan(-1);
    const enclosing = header.slice(0, i);
    const lastDiv = enclosing.lastIndexOf("<div");
    expect(header.slice(lastDiv, i)).toContain("flex-wrap");
  });

  // Tap targets: the capture shutter + hero bar hold the ≥44px floor (the
  // hero bar is h-16 = 64px; the shutter is h-26/w-26 = 104px).
  it("the capture hero bar is at least 44px tall", () => {
    const classes = readFileSync(join(SRC, "lib/ui/classes.ts"), "utf8");
    const match = classes.match(/BUTTON_CAPTURE\s*=\s*"([^"]+)"/);
    expect(match![1]).toMatch(/\bh-(?:1[1-9]|2\d)\b/);
  });
});
