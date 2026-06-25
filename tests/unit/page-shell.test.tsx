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

  it("card variant centers a single card on the card surface", () => {
    const { container } = render(<PageShell variant="card">x</PageShell>);
    const main = mainOf(container);
    expect(main?.className).toContain("items-center");
    expect(main?.className).toContain("justify-center");
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
