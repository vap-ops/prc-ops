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
import { NarrowSkeleton, type NarrowWidth } from "@/components/features/chrome/narrow-skeleton";
import { PageShell } from "@/components/features/chrome/page-shell";
import { ROUTE_LOADING_MESSAGE } from "@/lib/ui/route-announcement";

const APP = join(process.cwd(), "src", "app");

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
function sourceOf(...segments: string[]): string {
  return readFileSync(join(APP, ...segments), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

/** The variant a page's own PageShell call declares — three-way, not a boolean. */
function declaredVariant(source: string): "app" | "card" | "bare" {
  const call = source.match(/<PageShell\b[^>]*>/);
  if (!call) throw new Error("page renders no PageShell — the derivation is vacuous");
  const explicit = call[0].match(/variant="(app|card|bare)"/);
  return explicit ? (explicit[1] as "app" | "card" | "bare") : "app";
}

/**
 * The column width a page declares, read off the page rather than re-typed.
 * A single-column screen uses exactly ONE `max-w-*` — /coming-soon names it
 * three times (its two arms plus VisitorLanding's) and they agree — so more
 * than one distinct value means the page is no longer a single-column screen
 * and this table's premise, not the skeleton, is what needs revisiting.
 */
function declaredWidth(source: string): NarrowWidth {
  const found = [...new Set((source.match(/\bmax-w-(?:sm|md)\b/g) ?? []).map((m) => m.slice(6)))];
  if (found.length !== 1) {
    throw new Error(`expected exactly one column width, found [${found.join(", ")}]`);
  }
  return found[0] as NarrowWidth;
}

/**
 * The three narrow screens, each with the variant its PAGE renders. `card` is
 * PageShell's centred bg-card ground; `app` is the top-aligned bg-page one.
 * /coming-soon renders card for unserved roles and a bare+bg-card OperatorHub
 * for super_admin — both are a max-w-md column on the card ground, so `card`
 * is right for either arm.
 */
const NARROW_BOUNDARIES = [
  {
    route: "/login",
    Loading: LoginLoading,
    variant: "card" as const,
    width: "sm" as const,
    page: ["login", "page.tsx"],
  },
  {
    route: "/coming-soon",
    Loading: ComingSoonLoading,
    variant: "card" as const,
    width: "md" as const,
    page: ["coming-soon", "page.tsx"],
  },
  {
    route: "/profile",
    Loading: ProfileLoading,
    variant: "app" as const,
    width: "md" as const,
    page: ["profile", "page.tsx"],
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
        expect(column?.className.match(/\bmax-w-\S+/g), `${variant}/${width}: the column`).toEqual([
          `max-w-${width}`,
        ]);
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
    ({ variant, page }) => {
      // The invariant that makes this unit worth shipping: the fallback must not
      // flip the ground colour under the user. Read the page's own shell call —
      // these are async Server Components the suite cannot render.
      //
      // Three-way, deliberately: a boolean `card ? card : app` cannot see
      // `bare`, so switching a page to `variant="bare" className="bg-card"` —
      // exactly what /coming-soon's OperatorHub arm does — would flip the ground
      // under the user with the pin still green (fresh-eyes catch).
      expect(declaredVariant(sourceOf(...page)), `${page.join("/")}'s own PageShell call`).toBe(
        variant,
      );
    },
  );

  it.each(NARROW_BOUNDARIES)(
    "$route's fallback WIDTH matches what its PAGE renders",
    ({ width, page }) => {
      // The same derivation as the variant pin, for the other axis: #987 shipped
      // one fixed max-w-md and left /login 64px wide against its max-w-sm card.
      // Reading the width off the page is what stops that recurring — change the
      // page's column and this reds until the boundary follows.
      expect(declaredWidth(sourceOf(...page)), `${page.join("/")}'s own column width`).toBe(width);
    },
  );
});
