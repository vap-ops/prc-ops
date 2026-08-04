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
  // Field-First bans the raw Tailwind palette app-wide — every colour is a
  // globals.css token (done/attn/wait/danger/brand/ink/...). The original
  // guard only banned green-*, so raw zinc/slate/red drifted in unnoticed
  // (audit 2026-06 rank 10). Now ALL raw hue literals are banned, with a
  // short allowlist of files whose raw palette is intentional:
  //   - lib/status-colors.ts — the pill palette SSOT itself (spec 20 sun
  //     palette; solid saturated fills picked per-hue for glare/contrast).
  //   - photos/photo-lightbox-overlay.tsx — the enlarged-photo overlay is
  //     always-dark chrome over the photo, independent of the light/dark
  //     theme; app tokens flip with the theme so they can't express it.
  //   - app/login/login-button.tsx — the LINE-brand green login button
  //     (brand colour, not a theme colour).
  //   - components/auth/logout-button.tsx — one hover shade on the spec-38
  //     slate brand band with no token equivalent (brand-2 is the base).
  // Anything else using a raw hue must move to a token or earn a listed,
  // justified exception here.
  const RAW_HUE =
    /\b(?:bg|text|border|ring|stroke|fill|from|via|to|outline|decoration|divide|shadow|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d/;
  const RAW_HUE_ALLOWLIST = new Set([
    join("lib", "status-colors.ts"),
    join("components", "features", "photos", "photo-lightbox-overlay.tsx"),
    join("app", "login", "login-button.tsx"),
    join("components", "auth", "logout-button.tsx"),
  ]);
  it("uses no raw Tailwind hue literals outside the allowlisted palette homes", () => {
    const offenders = sources.filter((f) => !RAW_HUE_ALLOWLIST.has(f.rel) && RAW_HUE.test(f.text));
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  // Phantom-token guard (spec 316 U3 review, 2026-07-14). Tailwind v4 emits
  // NO CSS for a colour utility whose token is not in @theme — `bg-surface` /
  // `text-on-accent` silently style nothing and the element falls back to
  // inherited colours (the spec-306 badge sheet shipped that way). The
  // RAW_HUE guard above can't catch these (they aren't palette hues), so:
  // every colour-capable utility class in src must resolve to a --color-*
  // token (or --text-* for the type ramp), a Tailwind colour keyword, or a
  // structural non-colour form of the same prefix. Raw palette hues are
  // skipped here — RAW_HUE owns them (with its file allowlist). Only string
  // literals are scanned so prose in comments ("text-first") can't trip it.
  it("every colour-utility class resolves to a globals.css token (no phantom tokens)", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const colorTokens = new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    // --text-display--line-height style subkeys don't match ([a-z]+ then `:`).
    const textRamp = new Set([...css.matchAll(/--text-([a-z]+)\s*:/g)].map((m) => m[1]));
    const KEYWORDS = new Set(["white", "black", "transparent", "current", "inherit"]);
    const PALETTE_HUE =
      /^(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d+$/;
    // Structural (non-colour) suffixes each prefix legitimately takes. SVG/CSS
    // property names that appear inside markup strings (fill-rule, text-align)
    // are listed too — they're prose, not utility classes.
    const STRUCTURAL: Record<string, RegExp> = {
      text: /^(?:xs|sm|base|lg|[2-9]?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis|align|anchor|decoration|transform|overflow|indent)$|^shadow(?:-|$)/,
      bg: /^(?:none|cover|contain|auto|fixed|local|scroll|top|bottom|left|right|center|no-repeat)$|^repeat(?:-[xy]|-round|-space)?$|^(?:gradient|linear|radial|conic|clip|origin|blend|position|size|image)(?:-|$)/,
      border:
        /^(?:\d+|none|hidden|solid|dashed|dotted|double|collapse|separate|radius|width|style|spacing)(?:-|$)/,
      ring: /^(?:\d+|inset)$/,
      outline: /^(?:\d+|none|hidden|solid|dashed|dotted|double)$|^offset(?:-|$)/,
      fill: /^(?:none|rule|opacity)$/,
      stroke: /^(?:\d+|none|width|linecap|linejoin|dasharray|dashoffset|miterlimit|opacity)$/,
      divide: /^(?:[xy]$|[xy]-|none|solid|dashed|dotted|double)/,
      decoration: /^(?:\d+|auto|from-font|solid|dashed|dotted|double|wavy|none)$/,
      caret: /^(?!)/,
      accent: /^auto$/,
    };
    const CANDIDATE = new RegExp(
      `\\b(${Object.keys(STRUCTURAL).join("|")})-([a-z][a-z0-9-]*)`,
      "g",
    );
    const STRINGS = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

    const offenders: string[] = [];
    for (const f of sources) {
      for (const sm of f.text.matchAll(STRINGS)) {
        for (const m of sm[0].matchAll(CANDIDATE)) {
          const prefix = m[1]!;
          let suffix = m[2]!.replace(/\/\d+$/, ""); // strip opacity modifier
          // Side/offset forms: border-t-card → card, ring-offset-2 → 2.
          if (prefix === "border") suffix = suffix.replace(/^[tbrlxyse](?:-|$)/, "");
          if (prefix === "ring") suffix = suffix.replace(/^offset(?:-|$)/, "");
          if (suffix === "") continue; // bare side (border-b) or a dynamic `${...}` tail
          if (colorTokens.has(suffix) || KEYWORDS.has(suffix)) continue;
          if (prefix === "text" && textRamp.has(suffix)) continue;
          if (PALETTE_HUE.test(suffix)) continue; // RAW_HUE's jurisdiction
          if (STRUCTURAL[prefix]!.test(suffix)) continue;
          offenders.push(`${f.rel}: ${prefix}-${m[2]!}`);
        }
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
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

  // Date-input containment (feedback df3c2bb4 — "text box still overflowing",
  // the client-portal date pickers bursting their card on an iPhone). iOS
  // Safari (WebKit ≤ iOS 17) gives <input type="date"> an intrinsic width that
  // ignores width:100%, so even FIELD_INPUT's `w-full min-w-0` can't contain
  // it. `appearance: none` makes WebKit lay the control out as a normal text
  // field that obeys the box — the same fix the PO sheet's local FIELD_DATE
  // already ships. The systemic net is a base-layer rule so every current and
  // future date input is covered, not a per-surface class the next one forgets.
  it("date inputs get a base-layer appearance reset so iOS respects their width", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const rule = css.match(/input\[type="date"\]\s*\{[^}]*\}/);
    expect(rule, 'input[type="date"] base rule not found in globals.css').not.toBeNull();
    expect(rule![0], "must reset -webkit-appearance").toMatch(/-webkit-appearance:\s*none/);
    expect(rule![0], "must reset standard appearance").toMatch(/[^-]appearance:\s*none/);
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

  // An absolutely-positioned toggle knob MUST pin its horizontal origin. With
  // `left: auto` the knob falls back to its STATIC position, and a <button> is
  // text-align:center, so that resolves to the track's CENTRE — measured live at
  // `left: 22px` on a 44px track, putting the knob at 24–44px when off (jammed
  // against the right edge) and 42–62px when on (18px OUTSIDE the pill). It
  // shipped that way on every switch of /settings/notifications and the operator
  // spotted it, because nothing here can catch it: jsdom has no layout engine,
  // so RTL cannot measure a rect, and the classes look perfectly reasonable.
  // Hence a source guard — the honest instrument for a defect only real layout
  // can expose.
  it("every role=switch knob pins an explicit left- origin, never the static position", () => {
    // ⚠️ The first version of this guard was VACUOUS and a mutation caught it:
    // the className is a template literal whose ${...} holds quoted strings, and
    // a `[^`"]*` window stopped at the first quote — so the matched text never
    // contained `translate-x-` and every knob was skipped. Match the WHOLE
    // template block instead. Comments are stripped first: the explanatory note
    // beside the fix contains the literal `left-0.5`, so an un-stripped scan
    // would be satisfied by the comment describing the bug.
    const offenders: string[] = [];
    let knobsSeen = 0;
    for (const file of walkSrc(SRC).filter((f) => f.endsWith(".tsx"))) {
      const raw = readFileSync(file, "utf8");
      if (!raw.includes('role="switch"')) continue;
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const m of src.matchAll(/className=\{`([\s\S]*?)`\}/g)) {
        const cls = m[1] ?? "";
        if (!/\babsolute\b/.test(cls) || !/\btranslate-x-/.test(cls)) continue;
        knobsSeen += 1;
        if (!/\bleft-/.test(cls)) {
          offenders.push(`${relative(SRC, file)} :: ${cls.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    // A scan that matched nothing is an ABORT, not a pass — the failure mode
    // this very assertion shipped with the first time.
    expect(knobsSeen, "the knob scan matched NOTHING — the guard is vacuous").toBeGreaterThan(0);
    expect(offenders, `switch knob(s) with no explicit left-*: ${offenders.join(" | ")}`).toEqual(
      [],
    );
  });

  // ================================================================
  // Widened tap-floor pin (UX-audit 2026-08, gap G12 / finding F-010).
  // The original pin above bans exactly ONE literal (`min-h-9`) — its name
  // promises a 44px floor, its reach was one string, and a live 20×20px
  // remove-control (`h-5 w-5`, wp-schedule-panel) passed it.
  //
  // Instrument history, because this guard's own drafts kept repeating the
  // defect it hunts: draft 1 used `[^>]*` and truncated every tag at the `=>`
  // of an inline handler (missing the F-010 control); draft 2 tolerated `=>`
  // but still truncated at a bare `>`/`>=` comparison inside an attribute
  // expression (8 tags measured cut off before className); draft 3 (this one)
  // walks each tag with a brace+quote-aware scanner, so the tag text —
  // including template classNames inside braces — is scanned whole. It also
  // scans `size-*` (a review caught five live 32px `size-8` buttons the
  // h-only regex ignored — same class as F-010) and shared button-class
  // constants (`const *BTN* = "..."`), which never appear inside a tag.
  //
  // DECLARED residual blind spots (do not mistake this pin for proof of
  // absence): arbitrary values (`h-[36px]`), padding-derived heights, class
  // constants not named *BTN*/*BUTTON*, and non-<button> interactive elements.
  //
  // TAP_RATCHET is an EXACT per-file list of the matched sub-44 class strings
  // — not a count, so an allowlisted `h-10` cannot be silently swapped for a
  // new `h-6` in the same file, and fixing a frozen control REDs until its
  // entry is removed (the ledger stays true in both directions). Every entry
  // is a justified freeze: shrink it, never grow it. A NEW sub-44 button must
  // meet the floor (min-h-11), use a real 44px hit-slop, or earn a line here.
  it("no <button> carries a sub-44px height/size class outside the ratchet allowlist", () => {
    const SUB44 = /\b(?:min-)?(?:h|size)-(?:10|[1-9])(?![.\d])\b/g;
    // file (relative to src, forward slashes) -> EXACT sorted matched strings.
    const TAP_RATCHET: Record<string, string[]> = {
      // reorder-arrow pair (h-8, disabled-heavy) — office surface; ⚑ owed to
      // the G12 sweep lane.
      "app/projects/[projectId]/deliverable-reorder-controls.tsx": ["h-8"],
      // edit pencil (h-9) — office surface; ⚑ owed.
      "app/projects/[projectId]/edit-deliverable-sheet.tsx": ["h-9"],
      // clear-search circle inside the WP-list input — 32px AND text-ink-muted
      // on an interactive control; ⚑ owed (F-010 sibling, #1 route).
      "app/projects/[projectId]/work-package-list.tsx": ["size-8"],
      // receipt remove (32px, ink-muted); ⚑ owed.
      "components/features/expenses/office-expense-form.tsx": ["size-8"],
      // operator feedback-draft admin buttons (h-9, desktop); frozen.
      "components/features/feedback/feedback-drafts.tsx": ["h-9", "h-9"],
      // 20px photo-attach remove badge over a thumbnail corner — F-010's twin
      // on a FIELD surface; ⚑ owed FIRST in the G12 sweep (badge-over-image
      // needs a hit-slop design, not a blind min-h-11).
      "components/features/feedback/feedback-form.tsx": ["size-5"],
      "components/features/feedback/feedback-status-control.tsx": ["h-9"],
      // role="switch" tracks — 24×44px target: passes WCAG 2.5.8 AA (24px);
      // the house 44px floor for switches is an open design question (G12).
      "components/features/notifications/channel-preferences-form.tsx": ["h-6"],
      "components/features/notifications/preferences-form.tsx": ["h-6"],
      // always-dark photo overlay chrome — h-10 (40px), isolated corner/edge
      // targets with no adjacent controls (2.5.8 spacing exception).
      "components/features/photos/photo-lightbox-overlay.tsx": ["h-10", "h-10", "h-10"],
      // in-field search submit (h-8) — compact-in-input pattern; frozen.
      "components/features/projects/projects-filter-bar.tsx": ["h-8"],
      // PO-sheet zoom pair (ZOOM_BTN const) + line-remove, all 32px; ⚑ owed.
      "components/features/purchasing/create-purchase-order-sheet.tsx": ["size-8", "size-8"],
      "components/features/purchasing/po-charges-section.tsx": ["size-8"],
      // SA daily-plan suggestion rows (min-h-8) — FIELD surface; ⚑ owed.
      "components/features/sa/daily-plan-suggestions.tsx": ["min-h-8"],
      // PD reference star (h-10, tablet); frozen.
      "components/features/wp-catalog/reference-star-button.tsx": ["h-10"],
    };
    /** Every <button> opening tag, walked brace+quote-aware to its real `>`. */
    function buttonTags(src: string): string[] {
      const tags: string[] = [];
      let from = 0;
      for (;;) {
        const i = src.indexOf("<button", from);
        if (i === -1) break;
        let j = i + 7;
        let depth = 0;
        let quote: string | null = null;
        while (j < src.length) {
          const c = src[j];
          if (quote) {
            if (c === "\\") j++;
            else if (c === quote) quote = null;
          } else if (c === '"' || c === "'" || c === "`") quote = c;
          else if (c === "{") depth++;
          else if (c === "}") depth--;
          else if (c === ">" && depth === 0) break;
          j++;
        }
        tags.push(src.slice(i, j + 1));
        from = j + 1;
      }
      return tags;
    }
    let buttonsSeen = 0;
    const found = new Map<string, string[]>();
    for (const f of sources.filter((s) => s.rel.endsWith(".tsx"))) {
      const rel = f.rel.replace(/\\/g, "/");
      const src = f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const matches: string[] = [];
      for (const tag of buttonTags(src)) {
        buttonsSeen += 1;
        for (const s of tag.matchAll(SUB44)) matches.push(s[0]);
      }
      // Shared button-class constants never appear inside a tag — scan the
      // definitions (a review found the live 32px ZOOM_BTN this way).
      for (const m of src.matchAll(
        /\b(?:const|let)\s+\w*(?:BTN|BUTTON|Btn|Button)\w*\s*=\s*\n?\s*["'`]([^"'`]*)["'`]/g,
      )) {
        for (const s of m[1]!.matchAll(SUB44)) matches.push(s[0]);
      }
      if (matches.length > 0) found.set(rel, matches.sort());
    }
    // Vacuity abort: 632 real tags measured 2026-08-04 — a scanner losing a
    // third of the corpus must fail here, not read green.
    expect(buttonsSeen, "the <button> scan lost most of the corpus — vacuous").toBeGreaterThan(500);
    const report = (m: Map<string, string[]>) =>
      [...m.entries()].map(([k, v]) => `${k} :: ${v.join(",")}`).sort();
    expect(
      report(found),
      `sub-44px <button> classes drifted from TAP_RATCHET — a NEW sub-44 control needs ` +
        `min-h-11 / a real 44px hit-slop / a justified entry; a FIXED one needs its entry removed`,
    ).toEqual(report(new Map(Object.entries(TAP_RATCHET))));
  });

  // ================================================================
  // ink-muted usage ratchet (UX-audit 2026-08, gap G2 / finding F-015).
  // globals.css:87 says ink-muted is "dividers / placeholder / disabled ONLY",
  // yet 500+ sites use it — dozens of them on empty-state teaching copy that
  // renders at 2.77:1 in the default light theme, below AA, on an app read in
  // sunlight. A per-site allowlist is unmaintainable at this scale, so this is
  // a CEILING ratchet: the totals may fall, never rise. The G2 sweep lane
  // (move sentence copy to text-ink-secondary, 8.11:1) lowers these numbers —
  // re-measure and tighten the ceilings when it lands. A new surface reaching
  // for text-ink-muted on real copy pushes the count over and lands here:
  // use text-ink-secondary for anything a user must READ.
  it("text-ink-muted usage never grows (ceiling ratchet)", () => {
    let total = 0;
    const files = new Set<string>();
    for (const f of sources) {
      const src = f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const n = src.split("text-ink-muted").length - 1;
      if (n > 0) {
        total += n;
        files.add(f.rel);
      }
    }
    // EXACT counts, not ceilings — a `<=` ceiling turns every removal into
    // silently re-spendable budget (review catch). Removing a use is GOOD:
    // lower the numbers in the same PR; the pair is a live ledger, and the G2
    // sweep lane will walk them down. Never raise for readable copy.
    expect(
      total,
      `text-ink-muted occurrences changed — grew: use text-ink-secondary for readable copy ` +
        `(ink-muted is dividers/placeholder/disabled ONLY, globals.css:87); shrank: lower this ` +
        `number in the same PR`,
    ).toBe(398); // measured 2026-08-04 after the G2 sentence-copy sweep (103 sites → ink-secondary; wp-catalog deliberately deferred to the refauto lane's domain)
    expect(
      files.size,
      `the number of files using text-ink-muted changed — a NEW surface adopted a reserved ` +
        `token, or a file dropped it (then lower this number)`,
    ).toBe(205); // measured 2026-08-04 after the G2 sweep (24 files dropped their last readable-copy use)
  });

  // ================================================================
  // Token-contrast claims pin (UX-audit 2026-08, gap G2 / finding F-014;
  // consistency-machine gap §6 row 1). globals.css annotates tokens with
  // contrast-ratio claims ("~16:1 on card", "WCAG 1.4.11 ≥3:1") that NOTHING
  // verified — and the light edge-strong comment claimed ≥3:1 while the value
  // delivered 2.77:1, i.e. the comment out-ran the value and every reader
  // (human or model) inherited a false compliance claim. This pin computes the
  // real WCAG ratio (OKLCH → linear sRGB → relative luminance) for EVERY claim
  // the file makes, so a comment can never again promise a ratio the token
  // does not deliver. The instrument self-controls first (action token vs its
  // own ≈#1d4ed8 comment) — a wrong conversion aborts instead of mis-judging.
  // "~N:1" claims allow ≈7% approximation slack (the file's hex comments are
  // themselves approximations); "≥N:1" claims are strict WCAG floors.
  describe("token contrast claims (globals.css comments must not out-run values)", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");

    // --- OKLCH → linear sRGB → WCAG contrast (control-checked below) ---
    type Rgb = [number, number, number];
    function oklchToLinearSrgb(L: number, C: number, Hdeg: number): Rgb {
      const h = (Hdeg * Math.PI) / 180;
      const a = C * Math.cos(h);
      const b = C * Math.sin(h);
      const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
      const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
      const s_ = L - 0.0894841775 * a - 1.291485548 * b;
      const l = l_ ** 3;
      const m = m_ ** 3;
      const s = s_ ** 3;
      const clamp = (x: number) => Math.min(1, Math.max(0, x));
      return [
        clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
      ];
    }
    const relLum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const contrast = (c1: Rgb, c2: Rgb) => {
      const l1 = relLum(c1);
      const l2 = relLum(c2);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

    // --- token parsing: light = the PRC OPS @theme block, dark = .dark ---
    function parseTokens(block: string): Map<string, Rgb> {
      const out = new Map<string, Rgb>();
      for (const m of block.matchAll(
        /--color-([a-z0-9-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/g,
      )) {
        out.set(m[1]!, oklchToLinearSrgb(Number(m[2]), Number(m[3]), Number(m[4])));
      }
      return out;
    }
    // The FIELD-FIRST @theme block (not `@theme inline`, which aliases shadcn vars).
    // Parsed at collection; the STRUCTURE assertions live in the first it()
    // below so a missing block fails as a named test, not a collection error.
    const themeStart = css.indexOf("@theme {");
    const darkStart = css.indexOf(".dark {");
    const light =
      themeStart > -1 && darkStart > -1
        ? parseTokens(css.slice(themeStart, darkStart))
        : new Map<string, Rgb>();
    const dark =
      darkStart > -1
        ? new Map([...light, ...parseTokens(css.slice(darkStart))])
        : new Map<string, Rgb>();
    const WHITE: Rgb = [1, 1, 1];

    it("the theme blocks parse and the conversion instrument matches the file's own ≈hex comments (control)", () => {
      expect(themeStart, "PRC OPS @theme block not found").toBeGreaterThan(-1);
      expect(darkStart, ".dark block not found").toBeGreaterThan(-1);
      expect(light.size, "light token parse matched nothing — vacuous").toBeGreaterThan(20);
      // Control 1 — in-gamut: action oklch(0.49 0.21 264) ≈ #1d4ed8 per its
      // comment. A broken conversion mis-judges every claim below.
      // Control 2 — CLIPPING branch: done-strong's linear R goes negative and
      // is clamped; the clamp is a per-channel clip, NOT CSS Color 4 chroma
      // mapping, so its tolerance vs the ≈#047857 comment is wider (8/255).
      // 13 tokens clip today (incl. four strict-≥4.5 cat hues) — this control
      // is what keeps the clamp branch itself instrument-checked.
      const controls: Array<[string, number[], number]> = [
        ["action", [0x1d, 0x4e, 0xd8], 4],
        ["done-strong", [0x04, 0x78, 0x57], 8],
      ];
      for (const [name, expected, tol] of controls) {
        const tok = light.get(name);
        expect(tok, `${name} token missing`).toBeDefined();
        const gamma = tok!.map((c) => Math.round(toGamma(c) * 255));
        for (let i = 0; i < 3; i++) {
          expect(
            Math.abs(gamma[i]! - expected[i]!),
            `conversion control (${name}) drifted on channel ${i}: got ${gamma[i]}, css comment says ${expected[i]}`,
          ).toBeLessThanOrEqual(tol);
        }
      }
    });

    // Every ratio claim written in globals.css, as {fg, bg, min, strict}.
    // fg/bg name a token or "white". strict=true for "≥N:1" (a WCAG floor),
    // false for "~N:1" (an approximation — 7% slack). commentToken = the
    // token whose comment CARRIES the claim (the completeness pin below binds
    // each harvested comment to its token, so a claim cannot migrate to a
    // different token's comment undetected — review catch on the number-only
    // multiset); "cat" = the category block comment shared by all cat-w*.
    type Claim = {
      label: string;
      theme: "light" | "dark";
      fg: string;
      bg: string;
      min: number;
      strict: boolean;
      commentToken: string;
    };
    const CAT_TOKENS = [...light.keys()].filter((t) => /^cat-w\d\d$/.test(t));
    const CLAIMS: Claim[] = [
      // G2 landed: edge-strong meets the 1.4.11 floor in both themes again
      // (light 0.65 = 3.23:1, dark 0.53 = 3.32:1) and the claims are back.
      {
        label: "edge-strong on card ≥3:1 (WCAG 1.4.11)",
        theme: "light",
        fg: "edge-strong",
        bg: "card",
        min: 3,
        strict: true,
        commentToken: "edge-strong",
      },
      {
        label: "dark edge-strong on card ≥3:1",
        theme: "dark",
        fg: "edge-strong",
        bg: "card",
        min: 3,
        strict: true,
        commentToken: "edge-strong",
      },
      {
        label: "ink on card ~16:1",
        theme: "light",
        fg: "ink",
        bg: "card",
        min: 16,
        strict: false,
        commentToken: "ink",
      },
      {
        label: "ink-secondary on card ~7.4:1",
        theme: "light",
        fg: "ink-secondary",
        bg: "card",
        min: 7.4,
        strict: false,
        commentToken: "ink-secondary",
      },
      {
        label: "on-brand on brand ~17:1",
        theme: "light",
        fg: "on-brand",
        bg: "brand",
        min: 17,
        strict: false,
        commentToken: "brand",
      },
      {
        label: "attn-ink on attn-soft ~7:1",
        theme: "light",
        fg: "attn-ink",
        bg: "attn-soft",
        min: 7,
        strict: false,
        commentToken: "attn-ink",
      },
      {
        label: "on-attn on attn ~9:1",
        theme: "light",
        fg: "on-attn",
        bg: "attn",
        min: 9,
        strict: false,
        commentToken: "on-attn",
      },
      {
        label: "white on done-strong ~5.4:1",
        theme: "light",
        fg: "white",
        bg: "done-strong",
        min: 5.4,
        strict: false,
        commentToken: "done-strong",
      },
      // The category block claims ≥4.5:1 white text over every cat hue.
      ...CAT_TOKENS.map((t) => ({
        label: `white on ${t} ≥4.5:1`,
        theme: "light" as const,
        fg: "white",
        bg: t,
        min: 4.5,
        strict: true,
        commentToken: "cat",
      })),
      {
        label: "dark ink on card ~16:1",
        theme: "dark",
        fg: "ink",
        bg: "card",
        min: 16,
        strict: false,
        commentToken: "ink",
      },
      {
        label: "dark ink-secondary on card ~7:1",
        theme: "dark",
        fg: "ink-secondary",
        bg: "card",
        min: 7,
        strict: false,
        commentToken: "ink-secondary",
      },
    ];

    // Independent AA floors for every READABLE ink pair, in BOTH themes —
    // deliberately NOT derived from the comments. The claims pin above only
    // verifies claims that EXIST, so deleting a comment was the cheapest way
    // past it (review catch: this diff's own edge-strong comment corrections
    // were the first exercise of that escape hatch). These floors hold no
    // matter what the comments say. edge-strong (non-text, 1.4.11's 3:1) is
    // deliberately absent: it FAILS today (2.77/2.92) and its raise is gap
    // G2's lane — add it here when G2 lands. ink-muted has no floor BY RULE:
    // it must never carry readable copy (the usage ratchet above owns that).
    const AA_FLOORS: Array<{ fg: string; bg: string }> = [
      { fg: "ink", bg: "card" },
      { fg: "ink-secondary", bg: "card" },
      { fg: "on-brand", bg: "brand" },
      { fg: "on-fill", bg: "fill" },
      { fg: "on-attn", bg: "attn" },
      { fg: "attn-ink", bg: "attn-soft" },
      { fg: "done-ink", bg: "done-soft" },
      { fg: "danger-ink", bg: "danger-soft" },
      // G9: white ink on the danger FILL (badges) — was 3.22:1 in dark.
      { fg: "on-fill", bg: "danger" },
    ];
    it("every readable ink pair holds WCAG AA 4.5:1 in both themes (comment-independent)", () => {
      const failures: string[] = [];
      for (const theme of ["light", "dark"] as const) {
        const tokens = theme === "light" ? light : dark;
        for (const { fg, bg } of AA_FLOORS) {
          const f = tokens.get(fg);
          const g = tokens.get(bg);
          if (!f || !g) {
            failures.push(`${theme}: token missing (${fg} / ${bg})`);
            continue;
          }
          const actual = contrast(f, g);
          if (actual < 4.5) failures.push(`${theme} ${fg} on ${bg}: ${actual.toFixed(2)}:1 < 4.5`);
        }
      }
      for (const t of CAT_TOKENS) {
        const actual = contrast(WHITE, light.get(t)!);
        if (actual < 4.5) failures.push(`white on ${t}: ${actual.toFixed(2)}:1 < 4.5`);
      }
      expect(failures, failures.join("\n")).toEqual([]);
    });

    it("every claimed ratio is actually delivered by the token values", () => {
      expect(CAT_TOKENS.length, "cat token scan matched nothing — vacuous").toBeGreaterThan(0);
      const failures: string[] = [];
      for (const c of CLAIMS) {
        const tokens = c.theme === "light" ? light : dark;
        const fg = c.fg === "white" ? WHITE : tokens.get(c.fg);
        const bg = c.bg === "white" ? WHITE : tokens.get(c.bg);
        if (!fg || !bg) {
          failures.push(`${c.label}: token missing (${c.fg} / ${c.bg})`);
          continue;
        }
        const actual = contrast(fg, bg);
        const floor = c.strict ? c.min : c.min * 0.93;
        if (actual < floor) {
          failures.push(
            `${c.label} [${c.theme}]: comment claims ${c.min}:1 but the value delivers ${actual.toFixed(2)}:1 — fix the VALUE or correct the COMMENT (never leave a claim the token does not meet)`,
          );
        }
      }
      expect(failures, failures.join("\n")).toEqual([]);
    });

    it("every ratio-claim comment in globals.css has a matching CLAIMS entry (token-bound completeness)", () => {
      // A new ratio comment without a CLAIMS entry would be an unverified
      // promise — the exact hole this pin closes. Compared as a multiset of
      // TOKEN=NUMBER pairs: a bare count let a value edit drift (draft 1), and
      // a number-only multiset let a claim MIGRATE between tokens with
      // duplicate numbers (review catch on draft 2). Each harvested claim is
      // bound to the nearest PRECEDING --color- definition — except the
      // category block, whose shared comment precedes its tokens (bound "cat"
      // when --color-cat-w01 follows within 500 chars). The harvest also
      // catches BARE "N:1" (not only ~/≥) so a rewording cannot slip a claim
      // past it; prose that must mention a ratio without claiming one writes
      // "N to 1" (see the edge-strong comments).
      const claimed: string[] = [];
      for (const m of css.matchAll(/(?:[~≥]\s*)?(\d+(?:\.\d+)?):1/g)) {
        const idx = m.index!;
        const after = css.slice(idx, idx + 500);
        let token: string;
        if (after.includes("--color-cat-w01")) token = "cat";
        else {
          const before = css.slice(0, idx);
          const defs = [...before.matchAll(/--color-([a-z0-9-]+)\s*:/g)];
          token = defs.length > 0 ? defs[defs.length - 1]![1]! : "NONE";
        }
        claimed.push(`${token}=${m[1]}`);
      }
      const expected = [
        ...CLAIMS.filter((c) => c.commentToken !== "cat").map((c) => `${c.commentToken}=${c.min}`),
        "cat=4.5",
      ];
      expect(
        claimed.sort(),
        `globals.css ratio comments (token=min: ${claimed.join(", ")}) do not match the CLAIMS ` +
          `table — a comment was added, edited, or moved to a different token without updating ` +
          `CLAIMS in this file (or vice versa)`,
      ).toEqual(expected.sort());
    });
  });
});
