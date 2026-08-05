// Writing failing test first.
//
// UX-audit 2026-08 G8 follow-up. The G8 guard (role-home-loading) asserts every
// role home HAS a loading boundary and that it paints something. It says nothing
// about what a screen reader HEARS, and /portal is the one place that matters:
// of the 39 loading.tsx files in src/app, 38 delegate to PageSkeleton — whose
// first child is <p class="sr-only">กำลังโหลด…</p> — and src/app/portal/loading.tsx
// is the single bespoke skeleton, so a non-sighted contractor got animate-pulse
// blocks and complete silence.
//
// PageSkeleton is deliberately NOT swapped in: it hand-rolls its own <main>, but
// the root layout locks the body (h-full overflow-hidden, spec 64) and PageShell
// is THE page scroller — portal's bespoke skeleton renders PageShell and mirrors
// the real page's sticky header, so it is the structurally correct one. Only the
// announcement was missing.
//
// The consistency half is pinned by comparing against the string PageSkeleton
// actually renders, not by re-typing a literal: if either surface reworded its
// announcement, the two would drift silently (the term is a bare literal in both
// — the codebase does not hoist it; three other surfaces render it the same way).

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PortalLoading from "@/app/portal/loading";
import { PageSkeleton } from "@/components/features/chrome/page-skeleton";

/** The announcement PageSkeleton renders, read off the component itself. */
function sharedAnnouncement(): string {
  const { container, unmount } = render(<PageSkeleton />);
  const node = container.querySelector(".sr-only");
  const text = node?.textContent ?? "";
  unmount();
  return text;
}

describe("/portal loading boundary announces itself (UX-audit G8 follow-up)", () => {
  it("PageSkeleton really carries an sr-only announcement (the control is not vacuous)", () => {
    // If this ever empties, the comparison below would pass on "" for both.
    expect(sharedAnnouncement().trim().length).toBeGreaterThan(0);
  });

  it("renders a screen-reader-only loading announcement", () => {
    const { container } = render(<PortalLoading />);

    const announcement = container.querySelector(".sr-only");
    expect(
      announcement,
      "src/app/portal/loading.tsx paints animate-pulse blocks with no sr-only text — " +
        "a non-sighted contractor hears nothing while the page loads",
    ).not.toBeNull();
    expect(announcement?.textContent?.trim()).toBe(sharedAnnouncement().trim());
  });

  it("keeps the announcement inside the PageShell scroller, not floating above it", () => {
    // PageShell's <main> is the only scrolling element (spec 64 body lock), so
    // anything rendered outside it is unreachable once the page is taller than
    // the viewport. The announcement belongs to the skeleton it describes.
    const { container } = render(<PortalLoading />);

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(within(main as HTMLElement).getByText(sharedAnnouncement().trim())).toBeTruthy();
  });

  it("still paints the skeleton frame it is announcing", () => {
    // The announcement must be an ADDITION: a sighted user keeps the pulse blocks
    // mirroring the real page (sticky header + cards), which is what makes the
    // bespoke skeleton worth keeping over the shared PageSkeleton.
    const { container } = render(<PortalLoading />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(sharedAnnouncement().trim())).not.toBeNull();
  });
});
