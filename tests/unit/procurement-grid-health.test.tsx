import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcurementGrid } from "@/components/features/purchasing/procurement-grid";
import type { ProcurementGridRecord } from "@/components/features/purchasing/procurement-grid";
import { groupByProcurementBand } from "@/lib/purchasing/procurement-pipeline";

// Spec 113 — smoke test: with rows hitting every band/health, the grid renders
// ALL the health colors (not just green). Guards against a regression that
// washes the grid one colour. today is fixed so the cases are deterministic.

const TODAY = "2026-06-15";

function row(over: Partial<ProcurementGridRecord> & Pick<ProcurementGridRecord, "id" | "status">) {
  return {
    pr_number: 1,
    item_description: "item",
    priority: "normal",
    quantity: 1,
    unit: "ชิ้น",
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
  row({ id: "to-late", status: "approved", needed_by: "2026-06-01" }), // late
  row({ id: "to-soon", status: "approved", needed_by: "2026-06-18" }), // at_risk
  row({ id: "to-ok", status: "approved", needed_by: "2026-07-30" }), // on_track
  row({ id: "tr-late", status: "purchased", eta: "2026-06-10" }), // late + red ETA
  row({ id: "wait", status: "requested" }), // waiting
];

describe("ProcurementGrid health colors (spec 112/113 smoke)", () => {
  it("renders every health color, not just green", () => {
    const { container } = render(
      <ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />,
    );
    // late
    expect(container.querySelectorAll(".border-danger").length).toBeGreaterThan(0);
    // at_risk
    expect(container.querySelectorAll(".border-attn").length).toBeGreaterThan(0);
    // on_track
    expect(container.querySelectorAll(".border-done-strong").length).toBeGreaterThan(0);
    // waiting (awaiting approval)
    expect(container.querySelectorAll(".border-edge").length).toBeGreaterThan(0);
    // a late shipment's ETA is shown in danger text
    expect(container.querySelectorAll(".text-danger").length).toBeGreaterThan(0);
  });
});
