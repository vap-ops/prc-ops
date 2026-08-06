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

/** Comments stripped: prose about a variant must not satisfy a source pin. */
function sourceOf(...segments: string[]): string {
  return readFileSync(join(APP, ...segments), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/**
 * The three narrow screens, each with the variant its PAGE renders. `card` is
 * PageShell's centred bg-card ground; `app` is the top-aligned bg-page one.
 * /coming-soon renders card for unserved roles and a bare+bg-card OperatorHub
 * for super_admin — both are a max-w-md column on the card ground, so `card`
 * is right for either arm.
 */
const NARROW_BOUNDARIES = [
  { route: "/login", Loading: LoginLoading, variant: "card" as const, page: ["login", "page.tsx"] },
  {
    route: "/coming-soon",
    Loading: ComingSoonLoading,
    variant: "card" as const,
    page: ["coming-soon", "page.tsx"],
  },
  {
    route: "/profile",
    Loading: ProfileLoading,
    variant: "app" as const,
    page: ["profile", "page.tsx"],
  },
];

describe("NarrowSkeleton — the loading frame for single-column screens", () => {
  it("renders PageShell's <main> byte-for-byte, per variant", () => {
    expect(mainOf(<NarrowSkeleton variant="card" />).className).toBe(shellClassName("card"));
    expect(mainOf(<NarrowSkeleton variant="app" />).className).toBe(shellClassName("app"));
  });

  it("paints a narrow column, not a page-width one", () => {
    // max-w-md is the width all three real screens use (/login's card is
    // max-w-sm, one step narrower — 448 vs 384 against the 1240 it replaces).
    for (const variant of ["card", "app"] as const) {
      const column = render(<NarrowSkeleton variant={variant} />).container.querySelector(
        "main > div",
      );
      expect(column?.className, `${variant}: the column`).toContain("max-w-md");
      expect(column?.className, `${variant}: never the page width`).not.toContain("max-w-2xl");
    }
  });

  it("announces itself and paints a frame to announce", () => {
    const { container } = render(<NarrowSkeleton variant="card" />);

    expect(container.querySelector(".sr-only")?.textContent?.trim()).toBe(ROUTE_LOADING_MESSAGE);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(4);
  });
});

describe("the three narrow boundaries use it, with their page's own variant", () => {
  it.each(NARROW_BOUNDARIES)("$route delegates to NarrowSkeleton", ({ Loading, variant }) => {
    expect(mainOf(<Loading />).className).toBe(shellClassName(variant));
  });

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
      const source = sourceOf(...page);
      const declared = /<PageShell\s+variant="card"/.test(source) ? "card" : "app";

      expect(declared, `${page.join("/")} renders PageShell variant=${declared}`).toBe(variant);
    },
  );
});
