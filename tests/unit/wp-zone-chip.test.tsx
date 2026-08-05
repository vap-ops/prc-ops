// Spec 392 U3a — the work package's zone, on the WP detail.
//
// The gate here is the one the U1 gate-check made non-negotiable:
// `can_see_project` is live-FALSE for `technician` on every arm, and
// `project_zones` SELECT is `procurement/procurement_manager OR
// can_see_project`. So the zone is READ THROUGH RLS and the chip is driven by
// whether the row came back — a chip rendered from `zone_id` alone would show a
// name the reader cannot have, and a chip rendered as a permanent placeholder
// would be affordance-then-refuse.
//
// The LINK is a second, narrower gate: `/projects/:id/zones` is
// `requireRole(PM_ROLES)`, which REDIRECTS anyone else to their role home. A
// site_admin can read the zone but cannot open that page, so for them the chip
// states the zone and offers no door.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WpZoneChip } from "@/components/features/zones/wp-zone-chip";

describe("WpZoneChip", () => {
  it("names the zone it is given", () => {
    render(<WpZoneChip zone={{ code: "A1", name: "พื้นลานด้านซ้าย" }} href={null} />);
    expect(screen.getByText("พื้นลานด้านซ้าย")).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
  });

  it("renders NOTHING when the zone is absent or unreadable", () => {
    // Both cases arrive here as `null`: an unzoned WP, and a zone_id whose row
    // RLS withheld. Neither may leave a chip behind.
    const { container } = render(<WpZoneChip zone={null} href="/projects/p/zones" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no link when the viewer cannot open the zone map", () => {
    render(<WpZoneChip zone={{ code: "A1", name: "พื้นลานด้านซ้าย" }} href={null} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("links to the map — with the ?from the caller threaded — when the viewer can open it", () => {
    render(
      <WpZoneChip
        zone={{ code: "A1", name: "พื้นลานด้านซ้าย" }}
        href="/projects/p1/zones?from=%2Fprojects%2Fp1%2Fwork-packages%2Fw1"
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/projects/p1/zones?from=%2Fprojects%2Fp1%2Fwork-packages%2Fw1",
    );
  });

  it("gives the LINK the 44px tap floor, not just the pill", () => {
    // The pill's geometry was borrowed from WorkCategoryBadge, a
    // non-interactive <span> — ~22px tall. On a gloved-hand PWA that is a miss,
    // and the badge it would be missed into sits a gap-1.5 away in the same
    // row. The design-doctrine tap ratchet scans <button> tags only, so this is
    // the only thing standing between that and production.
    render(<WpZoneChip zone={{ code: "A1", name: "พื้นลานด้านซ้าย" }} href="/projects/p1/zones" />);
    expect(screen.getByRole("link").className).toContain("min-h-11");
  });

  it("names the destination for a screen reader — the chip's text alone reads as a label, not a door", () => {
    render(<WpZoneChip zone={{ code: "A1", name: "พื้นลานด้านซ้าย" }} href="/projects/p1/zones" />);
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("ผังโซน");
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("พื้นลานด้านซ้าย");
  });
});
