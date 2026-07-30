// Spec 380 U4 — the worklist rows carry the doc-chase verdict (same shape as
// the spec-301 category_match precedent): amber ไม่มีเอกสาร on missing, quiet
// เอกสารครบ when covered, ยกเว้นโดยบัญชี when accounting waived, and NOTHING on
// out-of-scope rows (pre-delivery states owe no docs yet).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ProcurementGrid,
  type ProcurementGridRecord,
} from "@/components/features/purchasing/procurement-grid";
import { PurchaseRequestCard } from "@/components/features/purchasing/purchase-request-card";
import { DOC_COMPLETE_LABEL, DOC_MISSING_LABEL, DOC_WAIVED_LABEL } from "@/lib/i18n/labels";
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
    doc_coverage: null,
    ...over,
  } satisfies ProcurementGridRecord;
}

function renderRows(rows: ProcurementGridRecord[]) {
  render(<ProcurementGrid groups={groupByProcurementBand(rows)} today={TODAY} />);
}

describe("procurement grid doc-chase chips (spec 380 U4)", () => {
  it("a delivered row missing docs shows the amber chip", () => {
    renderRows([row({ id: "m1", status: "delivered", doc_coverage: "missing" })]);
    expect(screen.getAllByText(DOC_MISSING_LABEL).length).toBeGreaterThan(0);
  });

  it("a covered row shows เอกสารครบ (typed or loose alike)", () => {
    renderRows([
      row({ id: "c1", status: "delivered", doc_coverage: "covered_typed" }),
      row({ id: "c2", status: "delivered", doc_coverage: "covered_loose" }),
    ]);
    expect(screen.getAllByText(DOC_COMPLETE_LABEL)).toHaveLength(2);
  });

  it("a waived row names the accounting waiver, not a false ครบ", () => {
    renderRows([row({ id: "w1", status: "delivered", doc_coverage: "waived" })]);
    expect(screen.getAllByText(DOC_WAIVED_LABEL).length).toBeGreaterThan(0);
    expect(screen.queryByText(DOC_COMPLETE_LABEL)).toBeNull();
  });

  it("the phone card carries the same verdict chip (procurement is phone-first)", () => {
    render(
      <PurchaseRequestCard
        request={{
          id: "pc1",
          pr_number: 260201,
          item_description: "ปูน",
          quantity: 1,
          unit: "ถุง",
          status: "delivered",
          priority: "normal",
          requested_at: "2026-06-01T00:00:00Z",
          needed_by: null,
          decided_at: null,
          purchased_at: null,
          shipped_at: null,
          delivered_at: "2026-06-10T00:00:00Z",
          eta: null,
        }}
        workPackage={null}
        requesterName={null}
        isMine={false}
        docCoverage="missing"
      />,
    );
    expect(screen.getAllByText(DOC_MISSING_LABEL).length).toBeGreaterThan(0);
  });

  it("pre-delivery rows stay quiet — no doc chip of any kind", () => {
    renderRows([
      row({ id: "p1", status: "approved", doc_coverage: "out_of_scope" }),
      row({ id: "p2", status: "purchased", doc_coverage: null }),
    ]);
    expect(screen.queryByText(DOC_MISSING_LABEL)).toBeNull();
    expect(screen.queryByText(DOC_COMPLETE_LABEL)).toBeNull();
    expect(screen.queryByText(DOC_WAIVED_LABEL)).toBeNull();
  });
});
