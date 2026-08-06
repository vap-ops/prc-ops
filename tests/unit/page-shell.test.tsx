// Unit tests for PageShell (spec 64) — THE page scroller. The body is
// locked (overflow-hidden); this main is the only thing that scrolls,
// so sticky headers and fixed chrome cannot drift on iOS bounce.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PageShell } from "@/components/features/chrome/page-shell";

function mainOf(container: HTMLElement) {
  return container.querySelector("main");
}

describe("PageShell", () => {
  it("renders a <main> scroller: h-full + overflow-y-auto + overscroll containment", () => {
    const { container } = render(<PageShell>x</PageShell>);
    const main = mainOf(container);
    expect(main?.className).toContain("h-full");
    expect(main?.className).toContain("overflow-y-auto");
    expect(main?.className).toContain("overscroll-y-contain");
  });

  // The page scroller must CLIP horizontal overflow. overflow-y-auto coerces an
  // unset overflow-x (visible) to auto, so without this any over-wide child
  // (a non-shrinking flex row, a wide table) would scroll the whole page
  // left-right — the 2026-06-25 bug (feedback 887ab7d8). clip (not hidden) pins
  // the x-axis without it ever becoming user-scrollable. This guard is the
  // single systemic defense: every route renders PageShell.
  it("clips horizontal overflow so no child can scroll the page left-right", () => {
    const { container } = render(<PageShell>x</PageShell>);
    const main = mainOf(container);
    expect(main?.className).toContain("overflow-x-clip");
  });

  it("app variant (default) carries the page wash + tab-bar clearance", () => {
    const { container } = render(<PageShell>x</PageShell>);
    const main = mainOf(container);
    expect(main?.className).toContain("bg-page");
    expect(main?.className).toContain("pb-20");
    expect(main?.className).toContain("sm:pb-0");
  });

  it("card variant centers a single card on the card surface — SAFELY", () => {
    // Writing failing test first (2026-08-06). `items-center` on a scrolling
    // flex container is the classic overflow trap: content taller than the
    // viewport is centred by pushing its top ABOVE the scrollable area, where
    // no scroll position can reach it. Measured in a real browser — a 900px
    // child in a 600px scroller sat at top -150 with scrollHeight 750 and
    // maxScroll 150, so **150px was unreachable**; with auto margins instead,
    // the same child reports top 0, scrollHeight 900 and maxScroll 300.
    //
    // Auto margins centre exactly like `items-center` while there IS free
    // space, and collapse to 0 when there is not. Until that was fixed,
    // /coming-soon's OperatorHub arm could not use this variant at all — it
    // rendered `bare` + its own padding (a 1:1 port of a pre-PageShell
    // hand-rolled <main>, NOT a deliberate opt-out), which left that page's
    // three arms disagreeing about vertical alignment.
    const { container } = render(<PageShell variant="card">x</PageShell>);
    const main = mainOf(container);
    expect(
      main?.className,
      "items-center clips a card taller than the viewport — centre with auto margins",
    ).not.toContain("items-center");
    expect(main?.className).toContain("[&>*]:m-auto");
    // BOTH halves of the mechanism, because auto margins only centre in a FLEX
    // formatting context: in a block box `margin-block: auto` computes to 0
    // (CSS 2.1 §10.6.3), so deleting `flex` would top-align all seven card
    // screens with every other assertion here still green. A fresh-eyes mutant
    // survived exactly that — `items-center` was self-contained, this is not.
    expect(main?.className, "auto margins centre only inside a flex container").toContain("flex");
    expect(main?.className).toContain("items-start");
    expect(main?.className).toContain("justify-center");
    // `py-10` lives HERE, not on a caller's className: auto margins collapse to 0
    // when a card overflows, so without it the content would touch the viewport
    // edge — and a caller-side `py-10` (which /coming-soon's hub used to carry)
    // is invisible to the loading fallback, putting a 40px step between the two
    // the moment that screen overflows. In the variant, the fallback inherits it.
    // Exact token set, not `toContain`: that passes for `sm:py-10`, `py-100` and
    // `py-10 py-0` — the two-utilities-one-property hazard §5 names, and the
    // sibling width pin already guards this way (fresh-eyes catch).
    expect(
      main?.className.match(/\S*py-\S+/g),
      "overflow breathing room belongs to the variant, exactly once",
    ).toEqual(["py-10"]);
    expect(main?.className).toContain("bg-card");
    expect(main?.className).not.toContain("bg-page");
  });

  it("bare variant adds nothing beyond the scroller; className appends", () => {
    const { container } = render(
      <PageShell variant="bare" className="bg-white px-6 py-10">
        <p>เนื้อหา</p>
      </PageShell>,
    );
    const main = mainOf(container);
    expect(main?.className).toContain("bg-white");
    expect(main?.className).not.toContain("bg-page");
    expect(main?.className).not.toContain("pb-20");
    expect(screen.getByText("เนื้อหา")).toBeInTheDocument();
  });
});
