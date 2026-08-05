// Writing failing test first.
//
// UX-audit 2026-08 G8 follow-up. The G8 guard (role-home-loading) asserts every
// role home HAS a loading boundary and that it paints something. It says nothing
// about what a screen reader is offered, and /portal is the one place that
// differed: every other loading.tsx delegates to page-skeleton.tsx — whose first
// child is an sr-only `กำลังโหลด…` — while src/app/portal/loading.tsx was the
// single bespoke skeleton and carried no announcement at all.
//
// SCOPE, as of the follow-up: #980's own review recorded that an sr-only <p>
// which is NOT a live region is reliably read only on a full page load — on a
// client-side navigation the fallback is a DOM swap, and readers announce
// inserted nodes only inside a live region. That follow-up has now landed: both
// surfaces render the shared <LoadingAnnouncement /> leaf, which keeps the
// static line for the full-load path AND writes to the ONE persistent region in
// the root layout for the client-navigation path. The parity pinned here is
// therefore two-part — same wording (below) and same live-region wiring (the
// last describe) — so upgrading one surface without the other still reds.
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
import { RouteAnnouncer } from "@/components/features/chrome/route-announcer";
import { ROUTE_LOADING_MESSAGE } from "@/lib/ui/route-announcement";

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

describe("both boundaries drive the ONE persistent live region", () => {
  // The audibility half. The static line above is only read on a full load; a
  // client-side navigation is a DOM swap, so the announcement has to reach a
  // region that was ALREADY in the document. Driven per surface rather than
  // once, because the failure mode this replaces is exactly one surface being
  // upgraded and the other left behind.
  const surfaces: [name: string, render: () => React.ReactElement][] = [
    ["PageSkeleton (the 38 delegating boundaries)", () => <PageSkeleton />],
    ["src/app/portal/loading.tsx (the bespoke one)", () => <PortalLoading />],
  ];

  it.each(surfaces)("%s writes to the layout region while mounted", (_name, ui) => {
    const { unmount } = render(
      <>
        <RouteAnnouncer />
        {ui()}
      </>,
    );

    const region = screen.getByRole("status");
    expect(
      region.textContent,
      "this boundary renders its sr-only line but never reaches the persistent " +
        "region, so a client-side navigation into it is silent",
    ).toBe(ROUTE_LOADING_MESSAGE);

    unmount();
  });

  it.each(surfaces)("%s falls silent once the real page replaces it", (_name, ui) => {
    render(<RouteAnnouncer />);
    const region = screen.getByRole("status");

    const boundary = render(ui());
    expect(region.textContent).toBe(ROUTE_LOADING_MESSAGE);

    boundary.unmount();
    expect(
      region.textContent,
      "the region still says กำลังโหลด… after the boundary unmounted — the next " +
        "navigation cannot re-announce, and the reader is told the page is still loading",
    ).toBe("");
  });

  it("says the same words through the region as it paints in the document", () => {
    // Two channels, one string. If the shared leaf's static <p> and its store
    // message ever diverge, a full load and a client navigation describe the
    // same state differently.
    expect(sharedAnnouncement().text).toBe(ROUTE_LOADING_MESSAGE);
  });
});
