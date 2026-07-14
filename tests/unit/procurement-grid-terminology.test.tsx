import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ProcurementGrid,
  type ProcurementGridRecord,
} from "@/components/features/purchasing/procurement-grid";
import { groupByProcurementBand } from "@/lib/purchasing/procurement-pipeline";
import { ETA_LABEL } from "@/lib/i18n/labels";

// Spec 211 U3 — reserve "รายการ" for PO line-items. The worklist grid used
// "รายการ" for the item-column header, the bundle hint and the selection count
// too, colliding with its line-count meaning on the same screen. The header must
// read "สิ่งที่ขอซื้อ" and the bundle copy must talk in "คำขอ" (requests).

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

const ROWS: ProcurementGridRecord[] = [row({ id: "a", status: "approved" })];

describe("ProcurementGrid terminology — reserve รายการ for line-items (spec 211 U3)", () => {
  it("names the item column สิ่งที่ขอซื้อ, not รายการ", () => {
    render(<ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />);
    expect(screen.getByText("สิ่งที่ขอซื้อ")).toBeInTheDocument();
    // With no PO groups and no drawer open, "รายการ" must no longer appear as a
    // standalone label (it used to be the item-column header). The legitimate
    // line-count use ("{n} รายการ" on a PO group) is unaffected — none here.
    expect(screen.queryByText("รายการ")).toBeNull();
  });

  // Spec 211 U10b — expected-arrival reads three ways across surfaces (grid "ETA",
  // drawer "คาดว่าจะได้รับ", PO card "กำหนดรับของ"). One ETA_LABEL SSOT; the grid drops
  // the English "ETA".
  it("labels the status/eta column with the Thai ETA term, not English ETA", () => {
    render(<ProcurementGrid groups={groupByProcurementBand(ROWS)} today={TODAY} />);
    expect(screen.getByText(`สถานะ / ${ETA_LABEL}`)).toBeInTheDocument();
    expect(screen.queryByText("สถานะ / ETA")).toBeNull();
  });
});
