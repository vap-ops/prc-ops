// Regression guard (reported 2026-06-29/30, feedback bc6df601 "The ui is wrong" /
// 703d7e91 "Elements misplaced": "the pills move vertically as well, it is
// supposed to move only horizontally"). The procurement-grid material-category
// filter strip (spec 230) is a horizontal-scroll row (`overflow-x-auto`), but its
// RadioChip pills were rendered with NO `shrink-0`/`whitespace-nowrap`. A flex
// item defaults to `flex-shrink:1`, so on a crowded row the chips shrank and their
// labels (e.g. `ทั้งหมด (5)`) wrapped INSIDE the pill — the pills grew taller and
// the strip stacked vertically instead of scrolling sideways.
//
// The sibling category strip in catalog-item-picker.tsx already guards this by
// passing `shrink-0 whitespace-nowrap` to every RadioChip. This test asserts the
// procurement grid carries the same guard: the strip contains its own horizontal
// overflow and each pill neither shrinks nor wraps its label. It fails if either
// guard is dropped.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ProcurementGrid,
  type ProcurementGridRecord,
} from "@/components/features/purchasing/procurement-grid";
import { groupByProcurementBand } from "@/lib/purchasing/procurement-pipeline";

const TODAY = "2026-06-15";

function row(
  over: Partial<ProcurementGridRecord> & Pick<ProcurementGridRecord, "id" | "status">,
): ProcurementGridRecord {
  return {
    pr_number: 1,
    item_description: "ปูนซีเมนต์",
    priority: "normal",
    quantity: 1,
    unit: "ถุง",
    supplier: null,
    amount: null,
    eta: null,
    needed_by: null,
    requested_at: "2026-06-01T00:00:00Z",
    decided_at: null,
    purchased_at: null,
    shipped_at: null,
    delivered_at: null,
    work_package_id: "wp",
    wp_code: null,
    wp_name: null,
    project_id: null,
    requested_by: null,
    requester_name: null,
    notes: null,
    decision_comment: null,
    received_by: null,
    delivery_note: null,
    doc_count: 0,
    purchase_order_id: null,
    po_number: null,
    category_id: null,
    category_name: null,
    ...over,
  } satisfies ProcurementGridRecord;
}

const ROWS: ProcurementGridRecord[] = [
  row({ id: "a", status: "approved", category_id: "steel", category_name: "เหล็ก" }),
  row({ id: "b", status: "approved", category_id: "paint", category_name: "สี" }),
  row({ id: "c", status: "approved", category_id: null, category_name: null }),
];

describe("procurement-grid category strip overflow containment", () => {
  it("the category strip contains its own horizontal overflow (never the page)", () => {
    const { container } = render(
      <ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />,
    );
    const strip = container.querySelector('[aria-label="กรองตามหมวดวัสดุ"]');
    expect(strip, "category strip not found").not.toBeNull();
    expect(strip!.className).toContain("overflow-x-auto");
  });

  it("each category pill neither shrinks nor wraps its label (scrolls, not stacks)", () => {
    render(<ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />);
    // The RadioChip renders an <input role=radio> wrapped by the styled <label>.
    const pills = screen.getAllByRole("radio").map((input) => input.closest("label"));
    expect(pills.length).toBeGreaterThan(1);
    for (const pill of pills) {
      expect(pill, "pill label not found").not.toBeNull();
      expect(pill!.className).toContain("shrink-0");
      expect(pill!.className).toContain("whitespace-nowrap");
    }
  });
});
