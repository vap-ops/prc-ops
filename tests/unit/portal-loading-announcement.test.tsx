// Writing failing test first.
//
// UX-audit 2026-08 G8 follow-up. The G8 guard (role-home-loading) asserts every
// role home HAS a loading boundary and that it paints something. It says nothing
// about what a screen reader is offered, and /portal is the one place that
// differed: every other loading.tsx delegates to page-skeleton.tsx — whose first
// child is an sr-only `กำลังโหลด…` — while src/app/portal/loading.tsx was the
// single bespoke skeleton and carried no announcement at all.
//
// SCOPE, stated honestly (review finding): an sr-only <p> that is NOT a live
// region is reliably read only on a full page load, where the reader walks the
// document top-down before the fallback is replaced. On a client-side navigation
// the fallback is a DOM swap, and readers announce inserted nodes only inside a
// live region — so this unit buys PARITY with the other 38 boundaries, not a
// guaranteed spoken announcement. Making it truly audible means a persistent
// live region in the layout (one already exists for toasts) and would change
// every boundary; recorded as a follow-up, deliberately not done here.
//
// The shared component is deliberately NOT swapped in: page-skeleton.tsx
// hand-rolls its own <main>, but the root layout locks the body (h-full
// overflow-hidden, spec 64) and PageShell is THE page scroller — portal's
// bespoke skeleton renders PageShell and mirrors the real page's sticky header,
// so it is the structurally correct one. That rationale is pinned below (a bare
// <main> in place of PageShell must fail), because it is the reason a future
// reader must not "simplify" this file into the shared component.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PortalLoading from "@/app/portal/loading";
import { PageSkeleton } from "@/components/features/chrome/page-skeleton";

interface Announcement {
  text: string;
  role: string | null;
  ariaLive: string | null;
  ariaAtomic: string | null;
}

function announcementOf(ui: React.ReactElement): Announcement | null {
  const { container, unmount } = render(ui);
  const node = container.querySelector(".sr-only");
  const found = node
    ? {
        text: (node.textContent ?? "").trim(),
        role: node.getAttribute("role"),
        ariaLive: node.getAttribute("aria-live"),
        ariaAtomic: node.getAttribute("aria-atomic"),
      }
    : null;
  unmount();
  return found;
}

/**
 * The announcement the shared skeleton actually renders, read off the component
 * rather than re-typed — so the two surfaces cannot drift apart silently.
 * Throws on an empty string: every comparison below would otherwise pass on ""
 * against "", and screen.getByText("") matches every empty node on the page.
 */
function sharedAnnouncement(): Announcement {
  const shared = announcementOf(<PageSkeleton />);
  if (!shared || shared.text.length === 0) {
    throw new Error("PageSkeleton renders no sr-only announcement — the control is vacuous");
  }
  return shared;
}

describe("/portal loading boundary announces itself (UX-audit G8 follow-up)", () => {
  it("PageSkeleton really carries an sr-only announcement (the control is not vacuous)", () => {
    expect(sharedAnnouncement().text.length).toBeGreaterThan(0);
  });

  it("renders a screen-reader-only loading announcement", () => {
    const announcement = announcementOf(<PortalLoading />);

    expect(
      announcement,
      "src/app/portal/loading.tsx paints animate-pulse blocks with no sr-only text — " +
        "a non-sighted contractor is offered nothing while the page loads",
    ).not.toBeNull();
    expect(announcement?.text).toBe(sharedAnnouncement().text);
  });

  it("matches the shared skeleton's announcement SEMANTICS, not just its wording", () => {
    // A text-only pin is one-directional: page-skeleton.tsx could gain
    // role="status"/aria-live (the fix that would make these boundaries truly
    // audible) and this file would stay a plain <p> with nothing red. Compare
    // the whole announcement, so upgrading one surface drags the other along.
    const shared = sharedAnnouncement();
    const portal = announcementOf(<PortalLoading />);

    expect(portal).toEqual(shared);
  });

  it("keeps the announcement inside PageShell — the real scroller, not a hand-rolled main", () => {
    // The spec-64 body lock (h-full overflow-hidden) makes PageShell's <main>
    // the only scrolling element. This is the whole reason the bespoke skeleton
    // survives instead of delegating to PageSkeleton, which hand-rolls a
    // min-h-screen <main> with no overflow-y-auto — so pin the shell's own
    // contract, not merely "some <main> exists".
    const { container } = render(<PortalLoading />);

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.className).toContain("h-full");
    expect(main?.className).toContain("overflow-y-auto");
    expect(within(main as HTMLElement).getByText(sharedAnnouncement().text)).toBeTruthy();
  });

  it("still paints the skeleton frame it is announcing", () => {
    // The announcement must be an ADDITION: a sighted user keeps the pulse
    // blocks mirroring the real page (sticky header + cards), which is what
    // makes the bespoke skeleton worth keeping.
    const { container } = render(<PortalLoading />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(sharedAnnouncement().text)).not.toBeNull();
  });
});
