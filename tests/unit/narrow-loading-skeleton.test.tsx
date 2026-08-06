// Writing failing test first.
//
// #985's fresh-eyes pass asked the question a consistency change never asks
// itself — which surfaces does it make WORSE — and found three: `/login`,
// `/coming-soon` and `/profile` all render a narrow single column, but their
// loading boundary delegates to `PageSkeleton`, which paints a header strip and
// list rows at PAGE_MAX_W. Measured on `/coming-soon` at 1280×800 with the
// streamed fallback and the resolved page both in one DOM: the fallback's
// container was **1240px on bg-page**, the page's **448px on bg-card**. Width is
// the smaller half — the GROUND flips too, so the whole screen flashes.
//
// Scope, stated honestly: `/login` and `/coming-soon` are both in the telemetry
// EXCLUDED_PREFIXES (src/lib/telemetry/scope.ts), so their usage is UNMEASURABLE
// — not zero. `/profile` is measurable and alive: 91 route views / 73 sessions /
// 9 roles in 60 days, latest 2026-08-05. That is why this unit does not stop at
// the two card screens: the one boundary with proven traffic is the app-ground
// one, and a card-only fix would have landed entirely on surfaces whose value
// cannot be observed.
//
// So the component takes PageShell's OWN variant vocabulary — `card` (centred on
// bg-card: /login, /coming-soon) and `app` (top-aligned on bg-page: /profile) —
// and each boundary's variant is pinned against the variant its PAGE renders.
//
// 2026-08-06, second pass: the column WIDTH is per-screen for the same reason.
// #987 shipped one fixed max-w-md and disclosed the residual — /login's card is
// max-w-sm, so its fallback was 64px too wide — and the operator asked for that
// closed too. Both axes are now derived from the page the boundary stands in
// for, so neither can drift back silently.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ComingSoonLoading from "@/app/coming-soon/loading";
import LoginLoading from "@/app/login/loading";
import ProfileLoading from "@/app/profile/loading";
import { NarrowSkeleton } from "@/components/features/chrome/narrow-skeleton";
import { PageShell } from "@/components/features/chrome/page-shell";
import { ROUTE_LOADING_MESSAGE } from "@/lib/ui/route-announcement";

const SRC = join(process.cwd(), "src");

function mainOf(ui: React.ReactElement): HTMLElement {
  const { container } = render(ui);
  const mains = container.querySelectorAll("main");
  expect(mains.length, "a boundary renders exactly one <main>").toBe(1);
  return mains[0] as HTMLElement;
}

/** PageShell's own rendered class string per variant — read, never re-typed. */
function shellClassName(variant: "app" | "card"): string {
  const cls = mainOf(<PageShell variant={variant}>x</PageShell>).className;
  if (!cls.includes("overflow-y-auto")) {
    throw new Error("PageShell no longer renders a scroller — the control is vacuous");
  }
  return cls;
}

/**
 * Comments stripped: prose about a variant must not satisfy a source pin, and
 * all three of these pages open with block-comment prose about their shell.
 * Whole comment LINES only — a general `/* … *\/` sweep is opened by
 * `accept="image/*"` and eats real code (the #982 lesson), so this drops lines
 * that START a JSDoc/banner comment or continue one, never a mid-line string.
 */
function sourceOf(relative: string): string {
  return readFileSync(join(SRC, relative), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

/**
 * The variant a file's PageShell calls declare — three-way, not a boolean, and
 * EVERY call in the file, not the first.
 *
 * Reading only the first was a hole a mutation found: `coming-soon/page.tsx`
 * renders TWO shells (the unserved-role card at the top, the super_admin
 * OperatorHub below), so reverting the hub to `variant="bare"` — the exact
 * regression this unit fixes — left the pin green because the card arm above it
 * still matched. A file with two disagreeing shells is precisely the defect.
 */
function declaredVariant(source: string): "app" | "card" | "bare" {
  const calls = source.match(/<PageShell\b[^>]*?>/g) ?? [];
  if (calls.length === 0) throw new Error("file renders no PageShell — the derivation is vacuous");
  const variants = [
    ...new Set(
      calls.map((call) => (call.match(/variant="(app|card|bare)"/)?.[1] ?? "app") as string),
    ),
  ];
  if (variants.length !== 1) {
    throw new Error(
      `${calls.length} PageShell calls in this file disagree: [${variants.join(", ")}]`,
    );
  }
  return variants[0] as "app" | "card" | "bare";
}

/**
 * The column width a screen declares, read off its own source rather than
 * re-typed. Three deliberate shapes, each a fresh-eyes finding:
 *
 * ① it reads EVERY file that renders one of the screen's arms, not just
 *    `page.tsx` — `/coming-soon`'s visitor arm lives in
 *    `components/features/register/visitor-landing.tsx`, so a page-only scan
 *    left it unpinned and the docstring claiming otherwise was simply wrong;
 * ② a match must be a COLUMN, not any `max-w-*` in the file: all five arms are
 *    `w-full … max-w-*`, so the token is only counted inside a class list that
 *    also carries `w-full`. A `max-w-sm` chip nested in the card no longer
 *    reds, and a column widened to `max-w-lg` while a chip still says `sm` no
 *    longer passes;
 * ③ the pattern keeps any variant PREFIX (`\S*max-w-\S+`, the house idiom from
 *    page-skeleton-shell.test.tsx) so `sm:max-w-md` cannot read as a base width,
 *    and it matches ANY width — a page moving to `max-w-lg` fails with the value
 *    it found rather than with an empty set nothing could satisfy.
 */
function declaredWidth(sources: string[]): string {
  const found = new Set<string>();
  for (const source of sources) {
    for (const attr of source.match(/class(?:Name)?="[^"]*"|`[^`]*`/g) ?? []) {
      if (!/\bw-full\b/.test(attr)) continue;
      for (const token of attr.match(/\S*max-w-\S+/g) ?? []) found.add(token.replace(/["`]/g, ""));
    }
  }
  const widths = [...found];
  if (widths.length !== 1) {
    throw new Error(
      `expected exactly one column width across the screen's arms, found [${widths.join(", ")}]`,
    );
  }
  return widths[0] as string;
}

/**
 * The three narrow screens, each with the variant its PAGE renders. `card` is
 * PageShell's centred bg-card ground; `app` is the top-aligned bg-page one.
 *
 * /coming-soon's three arms (unserved-role card · VisitorLanding · super_admin
 * OperatorHub) all declare `card` as of 2026-08-06. The hub had been `bare` +
 * `bg-card` since before PageShell existed (a 1:1 port of a hand-rolled <main>,
 * not a deliberate opt-out); it could only adopt the variant once `card` stopped
 * centring with `items-center`, which clipped content taller than the viewport.
 */
const NARROW_BOUNDARIES = [
  {
    route: "/login",
    Loading: LoginLoading,
    variant: "card" as const,
    width: "sm" as const,
    arms: ["app/login/page.tsx"],
  },
  {
    route: "/coming-soon",
    Loading: ComingSoonLoading,
    variant: "card" as const,
    width: "md" as const,
    arms: ["app/coming-soon/page.tsx", "components/features/register/visitor-landing.tsx"],
  },
  {
    route: "/profile",
    Loading: ProfileLoading,
    variant: "app" as const,
    width: "md" as const,
    arms: ["app/profile/page.tsx"],
  },
];

describe("NarrowSkeleton — the loading frame for single-column screens", () => {
  it("renders PageShell's <main> byte-for-byte, per variant", () => {
    expect(mainOf(<NarrowSkeleton variant="card" width="md" />).className).toBe(
      shellClassName("card"),
    );
    expect(mainOf(<NarrowSkeleton variant="app" width="md" />).className).toBe(
      shellClassName("app"),
    );
  });

  it("paints the column at the width it was given, and nothing wider", () => {
    // Writing failing test first (2026-08-06). The frame shipped at a fixed
    // max-w-md, which is right for /coming-soon and /profile and 64px too wide
    // for /login's max-w-sm card — the residual #987 disclosed rather than
    // fixed. Width is now per-screen, so assert the EXACT max-w-* token set:
    // `toContain("max-w-sm")` alone would pass on `max-w-sm max-w-md`, which is
    // the ui-conventions §5 two-utilities-one-property hazard.
    for (const variant of ["card", "app"] as const) {
      for (const width of ["sm", "md"] as const) {
        const column = render(
          <NarrowSkeleton variant={variant} width={width} />,
        ).container.querySelector("main > div");
        expect(column?.className.match(/\S*max-w-\S+/g), `${variant}/${width}: the column`).toEqual(
          [`max-w-${width}`],
        );
      }
    }
  });

  it("announces itself and paints a frame to announce", () => {
    const { container } = render(<NarrowSkeleton variant="card" width="md" />);

    expect(container.querySelector(".sr-only")?.textContent?.trim()).toBe(ROUTE_LOADING_MESSAGE);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(4);
  });

  it("the app arm paints a header strip; the card arm does not", () => {
    // Fresh-eyes catch: /profile renders DetailHeader (sticky, avatar + title)
    // above its column, so a headerless app frame drops the column ~148px at the
    // swap — WORSE on the vertical axis than the PageSkeleton it replaced, on
    // the one boundary here with measurable traffic. /login and /coming-soon
    // have no header at all, so the card arm must NOT grow one.
    const app = render(<NarrowSkeleton variant="app" width="md" />).container;
    const card = render(<NarrowSkeleton variant="card" width="md" />).container;

    expect(app.querySelectorAll("main > header").length, "the app arm mirrors DetailHeader").toBe(
      1,
    );
    expect(card.querySelectorAll("main > header").length, "card screens have no header").toBe(0);
    expect(app.querySelectorAll(".animate-pulse").length).toBeGreaterThan(
      card.querySelectorAll(".animate-pulse").length,
    );
  });
});

describe("the three narrow boundaries use it, with their page's own variant", () => {
  it.each(NARROW_BOUNDARIES)(
    "$route delegates to NarrowSkeleton",
    ({ Loading, variant, width }) => {
      // The shell class alone would also pass for a hand-rolled
      // `<PageShell variant="…"><LoadingAnnouncement /></PageShell>` with no frame
      // at all (fresh-eyes catch), so compare the boundary's whole rendered output
      // to the component's — that is what "delegates" means.
      const boundary = render(<Loading />).container.innerHTML;
      const component = render(<NarrowSkeleton variant={variant} width={width} />).container
        .innerHTML;

      expect(mainOf(<Loading />).className).toBe(shellClassName(variant));
      expect(boundary).toBe(component);
    },
  );

  it.each(NARROW_BOUNDARIES)("$route keeps the announcement", ({ Loading }) => {
    const { container } = render(<Loading />);
    expect(container.querySelector(".sr-only")?.textContent?.trim()).toBe(ROUTE_LOADING_MESSAGE);
  });

  it.each(NARROW_BOUNDARIES)(
    "$route's fallback ground matches what its PAGE renders",
    ({ variant, arms }) => {
      // The invariant that makes this unit worth shipping: the fallback must not
      // flip the ground colour under the user. Read the page's own shell call —
      // these are async Server Components the suite cannot render.
      //
      // Three-way, deliberately: a boolean `card ? card : app` cannot see
      // `bare`, so switching a page to `variant="bare" className="bg-card"`
      // would flip the ground under the user with the pin still green
      // (fresh-eyes catch).
      //
      // EVERY arm, not just the first (2026-08-06): /coming-soon's OperatorHub
      // arm was `bare` while its other two were `card`, so one boundary faced
      // three pages that did not agree with each other — the fallback could
      // match at most two, and its vertical alignment was wrong for the third.
      // Checking arms[0] alone could never see that. The arms are now required
      // to agree with each other AND with the boundary.
      for (const arm of arms) {
        const source = sourceOf(arm);
        expect(declaredVariant(source), `${arm}'s own PageShell call`).toBe(variant);
        // Writing failing test first (2026-08-06). The variant is not the whole
        // shell: an arm may also pass `className`, and the fallback cannot see it.
        // `className="bg-page"` flips the ground with the variant pin still green
        // (fresh-eyes catch), and `className="py-10"` — which the OperatorHub arm
        // carried — put a 40px step between page and fallback the moment that arm
        // overflowed. So NO arm may extend its shell: what these screens need goes
        // in the VARIANT, where the fallback inherits it too (`py-10` moved there
        // in this unit).
        //
        // ⚠️ This loop was DEAD — `/<PageShell\b…/` carried a literal backspace
        // (0x08) instead of the escape, written by a `node -e '…\\b…'` through
        // bash, so it matched nothing and the assertion passed over an empty
        // set. Repaired, and the non-vacuity is now ASSERTED rather than
        // inherited from `declaredVariant` throwing first: a `not.toMatch` over
        // zero matches is green, so the pattern must be shown to see its subject
        // (the house "a zero-match scan is an ABORT, not a pass" rule, applied
        // to the pattern rather than the file list).
        //
        // Declared limits: it reads source TEXT over a hardcoded `arms` list, so
        // a fourth arm in a new file, or `<PageShell {...props}>`, is invisible.
        // The ban is also deliberately narrow-screens-only — `PageShell
        // className={PAGE_MAX_W}` is legitimate elsewhere (accounting/review).
        const calls = source.match(/<PageShell\b[^>]*?>/g) ?? [];
        expect(calls.length, `${arm}: the PageShell scan matched nothing`).toBeGreaterThan(0);
        for (const call of calls) {
          expect(
            call,
            `${arm} extends its shell with a className the fallback cannot see`,
          ).not.toMatch(/className=/);
        }
      }
    },
  );

  it.each(NARROW_BOUNDARIES)(
    "$route's fallback WIDTH matches what its PAGE renders",
    ({ width, arms }) => {
      // The same derivation as the variant pin, for the other axis: #987 shipped
      // one fixed max-w-md and left /login 64px wide against its max-w-sm card.
      // Reading the width off the page is what stops that recurring — change the
      // page's column and this reds until the boundary follows.
      expect(declaredWidth(arms.map(sourceOf)), `${arms.join(" + ")} column width`).toBe(
        `max-w-${width}`,
      );
    },
  );
});
