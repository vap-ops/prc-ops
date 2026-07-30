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
import { beforeAll, describe, expect, it, vi } from "vitest";
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

// ---------------------------------------------------------------------------
// ONE src/ sweep for the whole file.
//
// Four static scans below ask four different questions of the SAME tree. Run
// per-`it` they walked and read it four times over — 3126 readFileSync calls /
// 17.9 MB, measured at 1712ms of a 2089ms total on an idle box against just
// 269ms of actual checking. Under full-suite CPU+IO load that multiplies: the
// colour-override scan was seen at 5456ms (past vitest's 5000ms default) and
// 18622ms, and 16 concurrent processes here put every one of the four between
// 2.1s and 3.4s. So the tree is walked once, read once, and filtered in memory.
//
// Linux CI runs this in well under a second, so a revert to per-scan reads
// could NEVER go red there — the cheapness guard at the bottom of this file is
// what holds the invariant instead.
// ---------------------------------------------------------------------------

const SRC_ROOT = path.resolve(__dirname, "../../src");

type SrcFile = { readonly rel: string; readonly content: string };

/** Filesystem work the sweep actually performed — read by the cheapness guard. */
const io = { dirs: 0, files: 0 };

let sweep: readonly SrcFile[] | null = null;

function walkSrc(dir: string): string[] {
  io.dirs += 1;
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walkSrc(p);
    return e.name.endsWith(".tsx") || e.name.endsWith(".ts") ? [p] : [];
  });
}

/** Every `.ts`/`.tsx` file under src/, read ONCE per process and memoized.
 *  `rel` is posix-normalised so a scan can compare it against a checked-in path. */
function srcFiles(): readonly SrcFile[] {
  if (sweep) return sweep;
  sweep = walkSrc(SRC_ROOT).map((abs) => {
    io.files += 1;
    return {
      rel: path.relative(SRC_ROOT, abs).replaceAll(path.sep, "/"),
      content: fs.readFileSync(abs, "utf8"),
    };
  });
  return sweep;
}

/** The `.tsx` subset — the two className scans only ever looked at components. */
function tsxFiles(): readonly SrcFile[] {
  return srcFiles().filter((f) => f.rel.endsWith(".tsx"));
}

// Warmed in a hook so the one-time cost lands on hookTimeout rather than on
// whichever `it` happens to run first (the #865 lightbox-warmup shape).
beforeAll(() => {
  srcFiles();
});

describe("absolute-centering contract (#236 bug class)", () => {
  it("the checker flags top-1/2 without the translate, and only that", () => {
    expect(topHalfViolations('className="absolute top-1/2 right-1.5 h-8"')).toHaveLength(1);
    expect(topHalfViolations('className="absolute top-1/2 -translate-y-1/2"')).toHaveLength(0);
    expect(topHalfViolations("className={`x ${y} top-1/2 -translate-y-1/2`}")).toHaveLength(0);
    expect(topHalfViolations('className="top-1"')).toHaveLength(0);
  });

  it("no className in src/ uses top-1/2 without -translate-y-1/2", () => {
    const offenders = tsxFiles().flatMap((f) =>
      topHalfViolations(f.content).map((h) => `${f.rel}: ${h}`),
    );
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
    const offenders = tsxFiles().flatMap((f) =>
      scrollRowTouchActionViolations(f.content, {
        allowManipulation: MANIPULATION_ALLOWED_FILES.has(f.rel),
      }).map((h) => `${f.rel}: ${h}`),
    );
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
// 17 compositions across registration, the client portal, contacts, feedback,
// profile and settings/view-as were affected. 11 of them lost the colour
// outright and rendered a NEUTRAL white card where the design says warn /
// success / danger; the rest lost only half (feedback-form's `bg-done-soft` and
// staff-register's `bg-danger-soft` DO outrank `bg-card`, while their borders
// did not). `text-attn-ink` kept applying throughout, because CARD sets no text
// colour — so the broken ones read as amber TEXT on a WHITE card, which looks
// deliberate, which is why nobody reported it.
//
// The fix is structural: CARD_LAYOUT carries the geometry alone, and a status
// card composes CARD_LAYOUT + its own colours, so a conflict cannot be formed.
// This scan is what keeps it that way — the defect is invisible to typecheck,
// lint AND RTL, all of which see a className string that faithfully contains
// every class the author wrote.
//
// SCOPE — background-color, border-color AND plain color. `color` was deferred
// when this scan first shipped and is folded in here: it is the same mechanism
// with the same invisibility, and it had two live instances. `text-danger`
// (68572) sorts before `text-ink` (69166), so a destructive confirm composing
// `${BUTTON_SECONDARY_MUTED} text-danger` rendered NEUTRAL; `text-ink` in turn
// sorts before `text-ink-secondary` (69272), so a "step up the emphasis"
// override on a muted constant is dead on arrival. Both are fixed here.
//
// Consequence worth stating: a `_LAYOUT` constant carries NO colour of ANY of
// the three properties. `BUTTON_SECONDARY_LAYOUT` still held `text-ink`, which
// made "compose the layout half and own your colours" only two-thirds true.
//
// KNOWN FALSE NEGATIVES, i.e. what this scan does NOT reach: a colour reached
// through a plain variable (a `TONE` const holding "bg-attn-soft", interpolated
// alongside the constant) or through string concatenation rather than a
// template literal; and a constant whose value is assembled at RUNTIME (a
// lookup keyed on a prop, `clsx`-style merging). All need value tracking. What
// IS reached: imports (incl. aliases), bindings initialised from a constant,
// file-local consts, and file-local consts DERIVED from another via a template
// literal — that last one because splitting a colour off a local constant
// creates exactly that shape, and it would otherwise remove the constant from
// this scan at the very moment someone fixes it.
// ---------------------------------------------------------------------------

/** Colour tokens are the design SSOT — read them from globals.css, never a list.
 *  Tailwind's colour KEYWORDS carry no `--color-*` token but still set the
 *  property, and they sort into the same alphabetical stream: `text-black`
 *  lands before `text-ink`, so `${BUTTON_SECONDARY} text-black` would be just
 *  as dead. Same keyword set design-doctrine.test.ts allows through. */
const COLOR_KEYWORDS = ["white", "black", "transparent", "current", "inherit"];
const COLOR_TOKENS = new Set([
  ...[
    ...fs
      .readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8")
      .matchAll(/--color-([a-z0-9-]+)\s*:/g),
  ].map((m) => m[1]!),
  ...COLOR_KEYWORDS,
]);

type ColorProperty = "background-color" | "border-color" | "color";

/** utility prefix → the CSS property it sets. `text-` also spells the type ramp
 *  (`text-body`, `text-meta`), which the token lookup filters out — those are
 *  not `--color-*` tokens. */
const COLOR_PREFIXES: ReadonlyArray<readonly [string, ColorProperty]> = [
  ["bg-", "background-color"],
  ["border-", "border-color"],
  ["text-", "color"],
];

/**
 * The colour utilities a class string applies UNCONDITIONALLY, keyed by the CSS
 * property they set. Variant-prefixed utilities (`hover:bg-sunk`) are excluded:
 * a variant carries a pseudo-class, so it outranks a bare utility on
 * specificity and overriding with one is the sanctioned idiom, not a bug.
 */
export function colorUtilitiesByProperty(classString: string): Record<ColorProperty, string[]> {
  const out: Record<ColorProperty, string[]> = {
    "background-color": [],
    "border-color": [],
    color: [],
  };
  // Template-literal delimiters and `${…}` punctuation are not whitespace, so a
  // utility sitting first or last in a literal arrives glued to a backtick.
  for (const raw of classString.replace(/[`'"${}]/g, " ").split(/\s+/)) {
    // `!` marks !important in BOTH Tailwind syntaxes (v3 prefix, v4 suffix); an
    // important utility wins on cascade rules, not on emission order.
    if (!raw || raw.includes(":") || raw.includes("!") || raw.includes("[")) continue;
    for (const [prefix, property] of COLOR_PREFIXES) {
      if (!raw.startsWith(prefix)) continue;
      // `bg-done/10` — the opacity modifier does not change which property it sets.
      const token = raw.slice(prefix.length).split("/")[0]!;
      if (COLOR_TOKENS.has(token)) out[property].push(raw);
    }
  }
  return out;
}

/**
 * Every class constant in scope for this file, local name → class string:
 * what it imports from the shared module PLUS the string constants it declares
 * itself. A file-local `const CARD` SHADOWS the import (team-map-view.tsx has
 * one, deliberately colour-free), so the local declaration wins — but it is
 * still checked, because a local constant carries colours exactly like a shared
 * one. Aliased imports resolve through: the literal names the LOCAL binding
 * while the colour set comes from the EXPORT.
 */
export function classConstantsInScope(
  content: string,
  shared: Record<string, string>,
): Map<string, string> {
  const scope = new Map<string, string>();
  for (const [, clause] of content.matchAll(
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*\/ui\/classes["']/g,
  )) {
    for (const part of (clause ?? "").split(",")) {
      const [exported, local] = part.trim().split(/\s+as\s+/);
      const value = exported ? shared[exported.trim()] : undefined;
      if (exported && value !== undefined) scope.set((local ?? exported).trim(), value);
    }
  }
  // Bindings initialised FROM a constant already in scope — `const shell = CARD`
  // and, the one that actually bit, a DEFAULT PARAMETER (`className = CARD`).
  // The composition then reads `${className}`, so without this the call site is
  // invisible: profile/pending-change-notice.tsx shipped exactly that way and no
  // `${CARD}` search could ever have found it.
  for (const [name, value] of [...scope]) {
    for (const m of content.matchAll(new RegExp(`(\\w+)\\s*=\\s*${name}\\b`, "g"))) {
      if (!scope.has(m[1]!)) scope.set(m[1]!, value);
    }
  }
  // Declared last so a local declaration shadows an import of the same name.
  for (const m of content.matchAll(/(?:^|\n)\s*const\s+(\w+)\s*=\s*("[^"]*"|'[^']*')\s*;/g)) {
    scope.set(m[1]!, m[2]!.slice(1, -1));
  }
  // A local constant DERIVED from one already in scope — `` const X = `${BASE} …` ``.
  // Splitting a colour off a local constant creates exactly this shape, so
  // without it a `_BASE` refactor silently removes the derived constant from
  // this scan (team-map-view's TIER_ACTION did, and it was one of the original
  // offenders). Two passes so a chain BASE → X → Y resolves.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const m of content.matchAll(/(?:^|\n)\s*const\s+(\w+)\s*=\s*`([^`]*)`\s*;/g)) {
      const resolved = m[2]!.replace(/\$\{(\w+)\}/g, (whole, ref) => scope.get(ref) ?? whole);
      if (!resolved.includes("${")) scope.set(m[1]!, resolved);
    }
  }
  return scope;
}

/**
 * Template literals, nesting-aware. A plain /`[^`]*`/ split mistakes the inner
 * literal of `` `${CARD} ${cond ? `x-${n}` : ""} bg-attn-soft` `` for the end of
 * the outer one, so everything after the nest — including the competing colour
 * — falls outside the scanned string. 17 files in src/ nest template literals.
 */
export function templateLiterals(content: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== "`") continue;
    let depth = 0;
    let j = i + 1;
    for (; j < content.length; j += 1) {
      const c = content[j];
      if (c === "\\") j += 1;
      else if (c === "$" && content[j + 1] === "{") depth += 1;
      else if (c === "}" && depth > 0) depth -= 1;
      else if (c === "`" && depth === 0) break;
    }
    out.push(content.slice(i, j + 1));
    i = j;
  }
  return out;
}

/**
 * Every className literal that composes a colour-carrying constant AND adds a
 * different colour for a property that constant already sets. The constant
 * applies unconditionally, so ANY other colour for the same property in the
 * same literal collides — including one tucked inside a `${cond ? … : …}` arm.
 * Arms are never compared with each other: only one of them ever renders.
 */
/** Drop comment LINES before scanning. A doc comment explaining this very bug
 *  quotes the broken composition verbatim, and the scan reads raw text — so
 *  without this, documenting the hazard trips the guard that forbids it. Only
 *  whole comment lines are removed, never a trailing `//` inside a line, so a
 *  URL sitting in a string literal cannot be mangled into a broken literal. */
export function stripCommentLines(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const t = line.trimStart();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : line;
    })
    .join("\n");
}

export function constColorOverrides(rawContent: string, shared: Record<string, string>): string[] {
  const out: string[] = [];
  const content = stripCommentLines(rawContent);
  const scope = classConstantsInScope(content, shared);
  for (const lit of templateLiterals(content)) {
    for (const [name, value] of scope) {
      if (!lit.includes("${" + name + "}")) continue;
      const own = colorUtilitiesByProperty(value);
      const added = colorUtilitiesByProperty(lit.replaceAll("${" + name + "}", " "));
      for (const [, property] of COLOR_PREFIXES) {
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
    // ZERO colour of any of the three properties — a `_LAYOUT` that kept even
    // `text-ink` would leave the call site fighting it for `color`.
    expect(colorUtilitiesByProperty(layout!)).toEqual({
      "background-color": [],
      "border-color": [],
      color: [],
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
    // a file's OWN `const CARD` SHADOWS the shared one, so it is judged on its
    // own colours — team-map-view.tsx's local CARD sets no border colour, so
    // adding one is not a conflict (reading it as the shared CARD would call a
    // correct surface broken)
    expect(
      constColorOverrides(
        'const CARD = "rounded-card bg-card border px-3 py-2";\n`${CARD} border-edge-strong`',
        card,
      ),
    ).toHaveLength(0);
    // …but a local constant that DOES carry the colour is still caught
    expect(
      constColorOverrides(
        'const PANEL = "rounded-card border border-edge bg-card";\n`${PANEL} bg-attn-soft`',
        card,
      ),
    ).toHaveLength(1);
    // a competing colour AFTER a nested template literal is still in the string
    expect(check('`${CARD} ${cond ? `pt-${n}` : ""} bg-attn-soft border-attn`')).toHaveLength(2);
    // a binding initialised from the constant IS the constant — the default
    // parameter form is how the profile pending-change banner stayed hidden
    expect(check("function N({ className = CARD }) {\n`${className} bg-attn-soft`")).toHaveLength(
      1,
    );
    expect(check("const shell = CARD;\n`${shell} border-attn`")).toHaveLength(1);
    // a local const DERIVED from another — splitting a colour off a local
    // constant makes exactly this shape, and it must not fall out of reach
    expect(
      constColorOverrides(
        'const BASE = "rounded-full border border-edge bg-card";\n' +
          "const TIER = `${BASE} text-action`;\n`${TIER} text-ink-secondary`",
        card,
      ),
    ).toHaveLength(1);
    // documenting the hazard must not BE the hazard: a comment quoting the
    // broken composition is not a call site
    expect(check("// never write `${CARD} bg-attn-soft` — it renders neutral\n")).toHaveLength(0);
    // Tailwind's colour KEYWORDS carry no design token but set the property and
    // sort into the same stream — `black` lands before `card`/`ink`, so these
    // are dead overrides too
    expect(check("`${CARD} bg-white`")).toHaveLength(1);
    expect(
      constColorOverrides('import { BTN } from "@/lib/ui/classes";\n`${BTN} text-black`', {
        BTN: "px-4 text-body text-ink",
      }),
    ).toHaveLength(1);
    // !important wins on cascade rules, not on emission order
    expect(check("`${CARD} bg-attn-soft!`")).toHaveLength(0);
    // plain `color` is the third property, and it bit in BOTH directions: a
    // muted constant swallowing a danger ink, and a muted constant outranking
    // an emphasis step-up
    const inked = { MUTED: "border border-edge bg-card px-3 text-ink" };
    expect(
      constColorOverrides(
        'import { MUTED } from "@/lib/ui/classes";\n`${MUTED} text-danger`',
        inked,
      ),
    ).toHaveLength(1);
    expect(
      constColorOverrides(
        'const STEP = "text-meta text-ink-secondary px-3";\n`${STEP} text-ink font-semibold`',
        {},
      ),
    ).toHaveLength(1);
    // the type ramp is not a colour — `text-body`/`text-meta` are not tokens
    expect(
      constColorOverrides(
        'import { MUTED } from "@/lib/ui/classes";\n`${MUTED} text-meta text-sm`',
        inked,
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

  // The scan reads `import { … } from "…/ui/classes"`. A namespace or default
  // import would sail straight past it, so pin that src/ never uses one — the
  // guard's reach is then a fact about the repo, not an assumption.
  it("src/ imports the class constants only in the named form the scan can read", () => {
    const odd = srcFiles().filter((f) =>
      /import\s+(?!type\s)(?:\*\s*as\s+\w+|\w+\s*,)\s*.*from\s*["'][^"']*\/ui\/classes["']/.test(
        f.content,
      ),
    );
    expect(
      odd.map((f) => f.rel),
      "namespace/default imports of @/lib/ui/classes are invisible to the colour-override scan — use named imports",
    ).toEqual([]);
  });

  it("no className in src/ overrides a colour a shared constant already sets", () => {
    const offenders = srcFiles().flatMap((f) =>
      constColorOverrides(f.content, CONSTANTS).map((h) => `${f.rel}: ${h}`),
    );
    expect(
      offenders,
      "the constant wins or loses by the GENERATED stylesheet's order, not the className's — compose CARD_LAYOUT (geometry only) and spell out both colours at the call site",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cheapness guard for the sweep above.
//
// Every scan in this file is a whole-tree static scan, and the cost is almost
// entirely I/O — so the file is only affordable while the tree is read ONCE.
// The regression is invisible everywhere it would normally be caught: it breaks
// no assertion, and Linux CI is fast enough that even four full sweeps stay
// green there. It only ever surfaces as a Windows timeout on a loaded box,
// which is not a signal anyone can act on. So the invariant is asserted here.
// ---------------------------------------------------------------------------

describe("src/ sweep cheapness guard", () => {
  it("walks and reads the tree exactly once, however many scans consume it", () => {
    const files = srcFiles();

    // A walk that silently yielded nothing would make all four scans above pass
    // VACUOUSLY — the one real hazard of hoisting them onto a shared loader.
    // Floors, not exact counts: src/ grows, and a collapsed sweep is the defect.
    expect(
      files.length,
      "the src/ sweep came back near-empty — every scan above is now vacuous",
    ).toBeGreaterThan(500);
    expect(tsxFiles().length, "the .tsx subset came back near-empty").toBeGreaterThan(300);

    // Exactly one read per file. Four unhoisted scans made this 4x the count.
    expect(io.files, "src/ was read more than once — hoist the scan, do not re-read").toBe(
      files.length,
    );

    const before = { ...io };
    srcFiles();
    tsxFiles();
    expect(io, "srcFiles() must be memoized — a later call re-walked or re-read src/").toEqual(
      before,
    );
  });

  it("reads the filesystem only from the shared loader", () => {
    // The counters above cannot see a scan that calls fs directly, so pin the
    // call sites too. The needle is built from a variable so this assertion
    // cannot match itself, and whitespace is collapsed first because prettier
    // wraps one of the real calls as `fs\n  .readFileSync(`.
    // Expected: globals.css, the loader, and this file's own read below.
    const countCalls = (src: string, fn: string) =>
      src.replace(/\s+/g, "").split(`fs.${fn}(`).length - 1;
    const own = stripCommentLines(
      fs.readFileSync(path.join(__dirname, "ui-class-contracts.test.tsx"), "utf8"),
    );
    expect(
      countCalls(own, "readFileSync"),
      "a new file read appeared outside the memoized loader — that is the per-scan sweep this guard exists to prevent",
    ).toBe(3);
    expect(countCalls(own, "readdirSync"), "src/ must be walked from walkSrc() alone").toBe(1);
  });
});
