// Spec 230 (ADR 0066 / S9) — the procurement grid surfaces the material category each
// purchase request buys: an opt-in filter chip (show-all by default, counts taken over
// the full set) + a per-row badge. Filtering narrows the ROWS only; the chip counts do
// not shift.

import { render, screen, fireEvent, within } from "@testing-library/react";
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
    wp_category_code: null,
    category_match: null,
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
  row({
    id: "a",
    status: "approved",
    item_description: "เหล็กเส้น",
    category_id: "steel",
    category_name: "เหล็ก",
  }),
  row({
    id: "b",
    status: "approved",
    item_description: "สีรองพื้น",
    category_id: "paint",
    category_name: "สี",
  }),
  row({
    id: "c",
    status: "approved",
    item_description: "ของเบ็ดเตล็ด",
    category_id: null,
    category_name: null,
  }),
];

describe("ProcurementGrid — material-category facet + badge (spec 230)", () => {
  it("renders a category badge inside a categorised row", () => {
    render(<ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />);
    const cell = screen.getByText("เหล็กเส้น").closest("td");
    expect(cell).not.toBeNull();
    expect(within(cell as HTMLElement).getByText("เหล็ก")).toBeInTheDocument();
  });

  it("shows a category facet: ทั้งหมด + a chip per present category + an unset bucket", () => {
    render(<ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />);
    expect(screen.getByRole("radio", { name: /ทั้งหมด/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /เหล็ก/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /สี/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /ไม่ระบุหมวดหมู่/ })).toBeInTheDocument();
  });

  it("defaults to show-all — every row is visible before any filter", () => {
    render(<ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />);
    expect(screen.getByText("เหล็กเส้น")).toBeInTheDocument();
    expect(screen.getByText("สีรองพื้น")).toBeInTheDocument();
    expect(screen.getByText("ของเบ็ดเตล็ด")).toBeInTheDocument();
  });

  it("selecting a category filters the rows but leaves the chip counts unchanged", () => {
    render(<ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />);
    fireEvent.click(screen.getByRole("radio", { name: /เหล็ก/ }));
    // rows: only the steel row remains
    expect(screen.getByText("เหล็กเส้น")).toBeInTheDocument();
    expect(screen.queryByText("สีรองพื้น")).toBeNull();
    expect(screen.queryByText("ของเบ็ดเตล็ด")).toBeNull();
    // counts unchanged: the สี chip still reports its full-dataset count of 1
    expect(screen.getByRole("radio", { name: /สี \(1\)/ })).toBeInTheDocument();
  });

  it("the unset bucket filters to rows with no category", () => {
    render(<ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />);
    fireEvent.click(screen.getByRole("radio", { name: /ไม่ระบุหมวดหมู่/ }));
    expect(screen.getByText("ของเบ็ดเตล็ด")).toBeInTheDocument();
    expect(screen.queryByText("เหล็กเส้น")).toBeNull();
    expect(screen.queryByText("สีรองพื้น")).toBeNull();
  });
});
