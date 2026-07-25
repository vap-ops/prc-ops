// Writing failing test first.
//
// Class-contract guards for two bug classes closed in the 2026-07-02 feedback
// pass — pinned here once, repo-wide, instead of per-surface whack-a-mole:
//
// 1. CHIP STRIPS (feedback bc6df601/703d7e91 → #235, and the same latent gap in
//    catalog-list closed by #237): a RadioChip inside an overflow-x-auto strip
//    that lacks `shrink-0 whitespace-nowrap` shrinks and wraps its label — the
//    strip stacks vertically. The guard moves INTO the component: RadioChip's
//    base class now carries both, so no call site can forget them again.
//
// 2. ABSOLUTE VERTICAL CENTERING (feedback 703d7e91 → #236): the idiom is TWO
//    classes — `top-1/2` positions the TOP edge at the midline and
//    `-translate-y-1/2` pulls the element back up. Sites that copy only the
//    first render the element hanging below its container (the misplaced
//    ค้นหา button). A static scan fails the build on any className string in
//    src/ that uses top-1/2 without the translate.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { RadioChip } from "@/components/features/common/radio-chip";
import * as UI_CLASSES from "@/lib/ui/classes";

describe("RadioChip strip contract (#235 bug class)", () => {
  it("never shrinks nor wraps its label, even with no className from the call site", () => {
    render(<RadioChip name="g" label="ทั้งหมด (5)" checked={false} onSelect={vi.fn()} />);
    const chip = screen.getByRole("radio").closest("label")!;
    expect(chip.className).toContain("shrink-0");
    expect(chip.className).toContain("whitespace-nowrap");
  });
});

// ---------------------------------------------------------------------------
// Static scan: top-1/2 must always travel with -translate-y-1/2.
// ---------------------------------------------------------------------------

// Every quoted or template string literal in the file content.
const STRING_LITERALS = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

/** String literals that position with top-1/2 but skip the -translate-y-1/2
 *  pullback — each is an element whose top edge sits on the container midline. */
export function topHalfViolations(content: string): string[] {
  const out: string[] = [];
  for (const [lit] of content.matchAll(STRING_LITERALS)) {
    if (lit.includes("top-1/2") && !lit.includes("-translate-y-1/2")) out.push(lit);
  }
  return out;
}

function tsxFiles(
  dir: string,
  match: (name: string) => boolean = (n) => n.endsWith(".tsx"),
): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p, match);
    return match(e.name) ? [p] : [];
  });
}

describe("absolute-centering contract (#236 bug class)", () => {
  it("the checker flags top-1/2 without the translate, and only that", () => {
    expect(topHalfViolations('className="absolute top-1/2 right-1.5 h-8"')).toHaveLength(1);
    expect(topHalfViolations('className="absolute top-1/2 -translate-y-1/2"')).toHaveLength(0);
    expect(topHalfViolations("className={`x ${y} top-1/2 -translate-y-1/2`}")).toHaveLength(0);
    expect(topHalfViolations('className="top-1"')).toHaveLength(0);
  });

  it("no className in src/ uses top-1/2 without -translate-y-1/2", () => {
    const srcRoot = path.resolve(__dirname, "../../src");
    const offenders = tsxFiles(srcRoot).flatMap((f) => {
      const hits = topHalfViolations(fs.readFileSync(f, "utf8"));
      return hits.map((h) => `${path.relative(srcRoot, f)}: ${h}`);
    });
    expect(offenders, "add -translate-y-1/2 next to top-1/2 (see #236)").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Static scan: overflow-x-auto scroll rows must lock the gesture to the
// horizontal axis (feedback 14263ad8 — "pills move vertically" on /projects).
//
// A bare `overflow-x-auto` container has NO `touch-action`, so the browser is
// free to resolve a slightly-diagonal swipe as page scroll instead of row
// scroll — the row (and everything in it) visibly jumps vertically mid-swipe
// on touch devices. `touch-action: pan-x pinch-zoom` locks a pan gesture
// starting on that element to the horizontal axis only, so the vertical
// component of the touch never reaches the page. `pinch-zoom` MUST travel
// with `pan-x`: the keyword alone would also disable two-finger zoom over the
// strip (a WCAG 1.4.10 reflow regression for low-vision users) — the pair
// keeps zoom while still killing the vertical jump.
// ---------------------------------------------------------------------------

/** TALL 2-axis surfaces (viewport-filling gantts) where
 *  `[touch-action:manipulation]` is the compliant form instead of the row-strip
 *  pair: pan-x-only would dead-zone vertical page scrolling across the whole
 *  viewport there, while manipulation still enables the horizontal pan the
 *  bug class is about AND preserves pinch-zoom (WCAG 1.4.10). The allowance is
 *  FILE-SCOPED on purpose — a thin row strip writing `manipulation` elsewhere
 *  would re-expose the vertical-jump bug and must keep failing. */
const MANIPULATION_ALLOWED_FILES = new Set([
  // Spec 327 U4 — 300+ WP lanes tall; vertical touches must scroll the page.
  "components/features/purchasing/procurement-timeline.tsx",
]);

/** String literals that scroll horizontally but never declare a compliant
 *  touch-action — each is a row that can bleed a horizontal swipe into a
 *  vertical page-scroll jump. `[touch-action:pan-x_pinch-zoom]` is the default
 *  contract; `[touch-action:manipulation]` counts ONLY when the caller marks
 *  the file as an allowed tall-2-axis surface (see MANIPULATION_ALLOWED_FILES). */
export function scrollRowTouchActionViolations(
  content: string,
  opts: { allowManipulation?: boolean } = {},
): string[] {
  const out: string[] = [];
  for (const [lit] of content.matchAll(STRING_LITERALS)) {
    if (lit.includes("overflow-x-auto") && !lit.includes("touch-action:pan-x_pinch-zoom")) {
      if (opts.allowManipulation && lit.includes("touch-action:manipulation")) continue;
      out.push(lit);
    }
  }
  return out;
}

describe("horizontal-scroll touch-action contract (14263ad8 bug class)", () => {
  it("the checker flags overflow-x-auto without touch-action:pan-x_pinch-zoom, and only that", () => {
    expect(scrollRowTouchActionViolations('className="flex overflow-x-auto gap-2"')).toHaveLength(
      1,
    );
    // pan-x alone is ALSO a violation — it silently disables pinch-zoom.
    expect(
      scrollRowTouchActionViolations('className="flex overflow-x-auto gap-2 [touch-action:pan-x]"'),
    ).toHaveLength(1);
    expect(
      scrollRowTouchActionViolations(
        'className="flex overflow-x-auto gap-2 [touch-action:pan-x_pinch-zoom]"',
      ),
    ).toHaveLength(0);
    // manipulation = pan-x + pan-y + pinch-zoom — the tall-2-axis-surface form
    // (spec 327 U4): compliant ONLY where the file allowance is granted; a thin
    // strip writing manipulation elsewhere keeps failing (vertical-jump bug).
    const manipulationLit =
      'className="relative overflow-x-auto border [touch-action:manipulation]"';
    expect(
      scrollRowTouchActionViolations(manipulationLit, { allowManipulation: true }),
    ).toHaveLength(0);
    expect(scrollRowTouchActionViolations(manipulationLit)).toHaveLength(1);
    expect(scrollRowTouchActionViolations('className="flex gap-2"')).toHaveLength(0);
  });

  it("no className in src/ uses overflow-x-auto without [touch-action:pan-x_pinch-zoom]", () => {
    const srcRoot = path.resolve(__dirname, "../../src");
    const offenders = tsxFiles(srcRoot).flatMap((f) => {
      const rel = path.relative(srcRoot, f).replaceAll(path.sep, "/");
      const hits = scrollRowTouchActionViolations(fs.readFileSync(f, "utf8"), {
        allowManipulation: MANIPULATION_ALLOWED_FILES.has(rel),
      });
      return hits.map((h) => `${rel}: ${h}`);
    });
    expect(
      offenders,
      "add [touch-action:pan-x_pinch-zoom] next to overflow-x-auto (see feedback 14263ad8; tall 2-axis surfaces may use [touch-action:manipulation] once allow-listed in MANIPULATION_ALLOWED_FILES)",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Static scan: a shared class constant's colour is NOT overridable at the call
// site (found 2026-07-26 while building the spec-306 carry-over banner).
//
// CARD carried `bg-card` + `border-edge`. Composing it with a status colour —
// `${CARD} border-attn bg-attn-soft` — puts TWO utilities for the SAME CSS
// property on one element, and the winner is decided by the GENERATED
// stylesheet's source order, NOT by the order of the className string. Tailwind
// v4 emits utilities alphabetically within a family, so `border-edge` sorts
// last and beat EVERY status border colour in this repo, while `bg-card` beat
// `bg-attn-soft`/`bg-action-soft` and lost to `bg-danger-soft`/`bg-done-soft`
// — the bug was invisible partly because it only bit half the palette.
//
// 13 call sites (registration, the client portal, contacts, feedback, view-as,
// the team map) rendered a NEUTRAL white card where the design says warn /
// success / danger. `text-attn-ink` DID apply, because CARD sets no text
// colour, so those cards read as amber TEXT on a WHITE card — which looks
// deliberate, which is why nobody reported it.
//
// The fix is structural: CARD_LAYOUT carries the geometry alone, and a status
// card composes CARD_LAYOUT + its own colours, so a conflict cannot be formed.
// This scan is what keeps it that way — the defect is invisible to typecheck,
// lint AND RTL, all of which see a className string that faithfully contains
// every class the author wrote.
// ---------------------------------------------------------------------------

/** Colour tokens are the design SSOT — read them from globals.css, never a list. */
const COLOR_TOKENS = new Set(
  [
    ...fs
      .readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8")
      .matchAll(/--color-([a-z0-9-]+)\s*:/g),
  ].map((m) => m[1]!),
);

type ColorProperty = "background-color" | "border-color";

/**
 * The colour utilities a class string applies UNCONDITIONALLY, keyed by the CSS
 * property they set. Variant-prefixed utilities (`hover:bg-sunk`) are excluded:
 * a variant carries a pseudo-class, so it outranks a bare utility on
 * specificity and overriding with one is the sanctioned idiom, not a bug.
 */
export function colorUtilitiesByProperty(classString: string): Record<ColorProperty, string[]> {
  const out: Record<ColorProperty, string[]> = { "background-color": [], "border-color": [] };
  // Template-literal delimiters and `${…}` punctuation are not whitespace, so a
  // utility sitting first or last in a literal arrives glued to a backtick.
  for (const raw of classString.replace(/[`'"${}]/g, " ").split(/\s+/)) {
    if (!raw || raw.includes(":") || raw.startsWith("!") || raw.includes("[")) continue;
    const bg = /^bg-(.+)$/.exec(raw);
    // `bg-done/10` — the opacity modifier does not change which property it sets.
    if (bg && COLOR_TOKENS.has(bg[1]!.split("/")[0]!)) out["background-color"].push(raw);
    const border = /^border-(.+)$/.exec(raw);
    if (border && COLOR_TOKENS.has(border[1]!.split("/")[0]!)) out["border-color"].push(raw);
  }
  return out;
}

/** local name → exported name, for what this file pulls in from the shared class
 *  module. A file is free to define its OWN `const CARD` (team-map-view.tsx
 *  does, deliberately colour-free) — that one shadows the import and is none of
 *  this guard's business, so scoping to the import list is what keeps the scan
 *  honest. Aliases are kept both ways: the literal names the LOCAL binding, the
 *  colour set comes from the EXPORT. */
export function importedClassConstants(content: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const [, clause] of content.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/ui\/classes["']/g,
  )) {
    for (const part of (clause ?? "").split(",")) {
      const [exported, local] = part.trim().split(/\s+as\s+/);
      if (exported) names.set((local ?? exported).trim(), exported.trim());
    }
  }
  return names;
}

/**
 * Every className literal that composes a colour-carrying constant AND adds a
 * different colour for a property that constant already sets. The constant
 * applies unconditionally, so ANY other colour for the same property in the
 * same literal collides — including one tucked inside a `${cond ? … : …}` arm.
 * Arms are never compared with each other: only one of them ever renders.
 */
export function constColorOverrides(content: string, constants: Record<string, string>): string[] {
  const out: string[] = [];
  const imported = importedClassConstants(content);
  for (const [lit] of content.matchAll(/`[^`]*`/g)) {
    for (const [name, exported] of imported) {
      const value = constants[exported];
      if (value === undefined) continue;
      if (!lit.includes("${" + name + "}")) continue;
      const own = colorUtilitiesByProperty(value);
      const added = colorUtilitiesByProperty(lit.replaceAll("${" + name + "}", " "));
      for (const property of ["background-color", "border-color"] as ColorProperty[]) {
        for (const a of added[property]) {
          for (const o of own[property]) {
            if (a === o) continue; // same utility twice is a no-op, not a conflict
            out.push(`${name} sets ${o}; this adds ${a} (${property}): ${lit}`);
          }
        }
      }
    }
  }
  return out;
}

describe("shared-constant colour-override contract (2026-07-26 bug class)", () => {
  // The module itself, not a regex over its source: these are the exact strings
  // the call sites receive, with every `${…}` already resolved.
  const CONSTANTS = Object.fromEntries(
    Object.entries(UI_CLASSES).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;

  it.each([
    ["CARD_LAYOUT", "CARD"],
    ["BUTTON_SECONDARY_LAYOUT", "BUTTON_SECONDARY"],
  ])("%s carries geometry ONLY — the conflict-free half of %s", (layoutName, fullName) => {
    const layout = CONSTANTS[layoutName];
    expect(layout, `src/lib/ui/classes.ts must export ${layoutName}`).toBeDefined();
    expect(colorUtilitiesByProperty(layout!)).toEqual({
      "background-color": [],
      "border-color": [],
    });
    // The full constant stays DERIVED from the layout half, so the two cannot
    // drift apart and a call site can never be handed a stale geometry.
    expect(CONSTANTS[fullName]).toContain(layout!);
  });

  it("the checker flags a competing colour, and only that", () => {
    const card = { CARD: "rounded-card border border-edge bg-card px-4 py-3 shadow-card" };
    const IMPORT = 'import { CARD } from "@/lib/ui/classes";\n';
    const check = (literal: string, constants = card) =>
      constColorOverrides(IMPORT + literal, constants);

    // the proven case — both the border and the background are dead
    expect(check("`${CARD} border-attn bg-attn-soft`")).toHaveLength(2);
    // a competing colour in the LAST position sits glued to the closing backtick
    expect(check("`${CARD} mb-4 bg-attn-soft`")).toHaveLength(1);
    // …and in the FIRST, glued to the opening one
    expect(check("`bg-attn-soft ${CARD}`")).toHaveLength(1);
    // a colour hidden inside a conditional arm still lands on the same element
    expect(check('`${CARD} ${fromTeam ? "border-action border-l-4" : ""}`')).toHaveLength(1);
    // geometry, spacing and border WIDTH are not colours
    expect(check("`${CARD} mb-4 border-l-4 rounded-card`")).toHaveLength(0);
    // a variant outranks the constant on specificity — the sanctioned override
    expect(check("`${CARD} hover:bg-sunk focus-visible:ring-action`")).toHaveLength(0);
    // repeating the constant's own colour changes nothing
    expect(check("`${CARD} border-edge border-dashed`")).toHaveLength(0);
    // the fix shape: the layout half carries no colour, so nothing can collide
    expect(
      constColorOverrides(
        'import { CARD_LAYOUT } from "@/lib/ui/classes";\n`${CARD_LAYOUT} border-attn bg-attn-soft`',
        { CARD_LAYOUT: "rounded-card border px-4 py-3 shadow-card" },
      ),
    ).toHaveLength(0);
    // a constant that is merely mentioned, not composed, is not a call site
    expect(check("`bg-attn-soft`")).toHaveLength(0);
    // a file's OWN `const CARD` shadows the shared one — not this guard's
    // business, and treating it as the import misreads a correct surface
    // (team-map-view.tsx, whose local CARD carries no border colour at all).
    expect(
      constColorOverrides(
        'const CARD = "rounded-card bg-card border px-3 py-2";\n`${CARD} border-edge-strong`',
        card,
      ),
    ).toHaveLength(0);
    // an aliased import is still the shared constant: the literal names the
    // LOCAL binding while the colours come from the EXPORT
    expect(
      constColorOverrides(
        'import { CARD as SHELL } from "@/lib/ui/classes";\n`${SHELL} bg-attn-soft`',
        card,
      ),
    ).toHaveLength(1);
  });

  it("no className in src/ overrides a colour a shared constant already sets", () => {
    const srcRoot = path.resolve(__dirname, "../../src");
    const offenders = tsxFiles(srcRoot, (n) => n.endsWith(".tsx") || n.endsWith(".ts")).flatMap(
      (f) => {
        const rel = path.relative(srcRoot, f).replaceAll(path.sep, "/");
        return constColorOverrides(fs.readFileSync(f, "utf8"), CONSTANTS).map(
          (h) => `${rel}: ${h}`,
        );
      },
    );
    expect(
      offenders,
      "the constant wins or loses by the GENERATED stylesheet's order, not the className's — compose CARD_LAYOUT (geometry only) and spell out both colours at the call site",
    ).toEqual([]);
  });
});
