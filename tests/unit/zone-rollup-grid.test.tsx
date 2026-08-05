// Spec 392 U3a — the zone × หมวดงาน rollup on the project page. This is the
// surface the operator asked for by name ("track work per zone"), so what it
// states has to be true of the whole project, not of the mapped part of it.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ZoneRollupGrid } from "@/components/features/zones/zone-rollup-grid";
import { buildZoneRollup, type RollupWorkPackage } from "@/lib/zones/zone-rollup";
import { ZONE_ROLLUP_OWN_ONLY_NOTE } from "@/lib/i18n/labels";
import type { ZoneRowInput } from "@/lib/zones/zone-list";

const zone = (over: Partial<ZoneRowInput> & { id: string }): ZoneRowInput => ({
  code: "Z",
  name: "โซน",
  shape: "rect",
  sortOrder: 0,
  parentZoneId: null,
  ...over,
});

const wp = (over: Partial<RollupWorkPackage>): RollupWorkPackage => ({
  zoneId: null,
  categoryId: null,
  status: "not_started",
  isGroup: false,
  ...over,
});

const CATS = [
  { id: "c1", code: "W01", name: "งานโครงสร้าง", sortOrder: 0 },
  { id: "c2", code: "W05", name: "งานพื้น", sortOrder: 1 },
];

const rollupOf = (zones: ZoneRowInput[], workPackages: RollupWorkPackage[]) =>
  buildZoneRollup({ zones, categories: CATS, workPackages });

describe("ZoneRollupGrid", () => {
  it("renders one row per zone and one column per used work-category", () => {
    render(
      <ZoneRollupGrid
        rollup={rollupOf(
          [zone({ id: "z1", code: "A", name: "พื้นลานด้านซ้าย" })],
          [wp({ zoneId: "z1", categoryId: "c1" }), wp({ zoneId: "z1", categoryId: "c2" })],
        )}
      />,
    );
    expect(screen.getByText("พื้นลานด้านซ้าย")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "งานโครงสร้าง" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "งานพื้น" })).toBeInTheDocument();
  });

  it("states each zone's completion percentage", () => {
    render(
      <ZoneRollupGrid
        rollup={rollupOf(
          [zone({ id: "z1", code: "A", name: "พื้นลานด้านซ้าย" })],
          [
            wp({ zoneId: "z1", categoryId: "c1", status: "complete" }),
            wp({ zoneId: "z1", categoryId: "c1" }),
          ],
        )}
      />,
    );
    const row = screen.getByRole("row", { name: /พื้นลานด้านซ้าย/ });
    expect(within(row).getByText("50%")).toBeInTheDocument();
  });

  it("shows the unzoned remainder — a grid of only the mapped work reads as full coverage", () => {
    render(
      <ZoneRollupGrid
        rollup={rollupOf(
          [zone({ id: "z1", code: "A", name: "พื้นลานด้านซ้าย" })],
          [wp({ zoneId: "z1", categoryId: "c1" }), wp({ zoneId: null, categoryId: "c1" })],
        )}
      />,
    );
    expect(screen.getByRole("row", { name: /ยังไม่ระบุโซน/ })).toBeInTheDocument();
  });

  it("reports an empty zone as —, never as 0%", () => {
    // Until the assignment screen lands (U4) NOTHING writes zone_id from the
    // UI, so a freshly drawn map is every zone empty. "0%" would tell that PM
    // the work is not started; the truth is there is no work here yet.
    render(<ZoneRollupGrid rollup={rollupOf([zone({ id: "z1", code: "A" })], [])} />);
    const row = screen.getByRole("row", { name: /A/ });
    expect(within(row).queryByText("0%")).toBeNull();
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("states the own-count rule ONLY when a zone actually has a child", () => {
    // The indent is a claim about the tree, which is true; it is NOT a claim
    // that the parent summarises its children, which the numbers do not
    // support. Said out loud only where nesting exists, so the flat case (every
    // project today) carries no extra copy.
    const flat = render(
      <ZoneRollupGrid
        rollup={rollupOf([zone({ id: "z1", code: "A" })], [wp({ zoneId: "z1", categoryId: "c1" })])}
      />,
    );
    expect(flat.queryByText(ZONE_ROLLUP_OWN_ONLY_NOTE)).toBeNull();
    flat.unmount();

    render(
      <ZoneRollupGrid
        rollup={rollupOf(
          [
            zone({ id: "parent", code: "A" }),
            zone({ id: "child", code: "A1", sortOrder: 1, parentZoneId: "parent" }),
          ],
          [wp({ zoneId: "child", categoryId: "c1" })],
        )}
      />,
    );
    expect(screen.getByText(ZONE_ROLLUP_OWN_ONLY_NOTE)).toBeInTheDocument();
  });

  it("renders nothing at all when the project has no zones — today's live state on every project", () => {
    const { container } = render(
      <ZoneRollupGrid rollup={rollupOf([], [wp({ categoryId: "c1" })])} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("locks the scroll gesture on its own horizontal scroller", () => {
    // A bare overflow-x-auto row hijacks vertical page scroll on touch; the
    // pan-x + pinch-zoom pair is the repo's build-failing contract, and this
    // grid is wide by construction.
    const { container } = render(
      <ZoneRollupGrid
        rollup={rollupOf([zone({ id: "z1", code: "A" })], [wp({ zoneId: "z1", categoryId: "c1" })])}
      />,
    );
    const scroller = container.querySelector(".overflow-x-auto");
    expect(scroller?.className).toContain("[touch-action:pan-x_pinch-zoom]");
  });
});
