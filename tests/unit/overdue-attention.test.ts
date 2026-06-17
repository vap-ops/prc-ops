// Spec 138 U1 — the "ต้องติดตามด่วน" urgent-follow-up panel reads from this
// pure helper. It surfaces the actual overdue in-transit deliveries (the items
// behind the เกินกำหนด count), most-overdue first, capped for a phone panel.

import { describe, it, expect } from "vitest";

import {
  selectOverdueFollowUp,
  type OverdueAttentionRow,
} from "@/lib/purchasing/overdue-attention";

const TODAY = "2026-06-18";

function row(over: Partial<OverdueAttentionRow> & { id: string }): OverdueAttentionRow {
  return {
    pr_number: 1,
    item_description: "ปูนซีเมนต์",
    status: "on_route",
    eta: "2026-06-12",
    supplier: "เอสซีจี",
    amount: 1000,
    ...over,
  };
}

describe("selectOverdueFollowUp", () => {
  it("keeps only in-transit rows whose ETA is before today", () => {
    const rows: OverdueAttentionRow[] = [
      row({ id: "a", status: "purchased", eta: "2026-06-14" }), // overdue, in-transit ✓
      row({ id: "b", status: "on_route", eta: "2026-06-12" }), // overdue, in-transit ✓
      row({ id: "c", status: "on_route", eta: "2026-06-22" }), // future ✗
      row({ id: "d", status: "approved", eta: "2026-06-10" }), // to_order band ✗
      row({ id: "e", status: "delivered", eta: "2026-06-01" }), // received band ✗
      row({ id: "f", status: "on_route", eta: null }), // no ETA ✗
      row({ id: "g", status: "requested", eta: "2026-06-01" }), // awaiting band ✗
      row({ id: "h", status: "purchased", eta: TODAY }), // == today, not < ✗
    ];
    const got = selectOverdueFollowUp(rows, TODAY);
    expect(got.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("sorts most-overdue first (earliest ETA) and computes whole-day lateness", () => {
    const got = selectOverdueFollowUp(
      [row({ id: "a", eta: "2026-06-14" }), row({ id: "b", eta: "2026-06-12" })],
      TODAY,
    );
    expect(got.map((x) => [x.id, x.overdueDays])).toEqual([
      ["b", 6],
      ["a", 4],
    ]);
  });

  it("caps the list at the limit (default 4), keeping the most overdue", () => {
    const rows: OverdueAttentionRow[] = [
      row({ id: "a", eta: "2026-06-17" }),
      row({ id: "b", eta: "2026-06-16" }),
      row({ id: "c", eta: "2026-06-15" }),
      row({ id: "d", eta: "2026-06-14" }),
      row({ id: "e", eta: "2026-06-13" }),
    ];
    const got = selectOverdueFollowUp(rows, TODAY);
    expect(got.map((x) => x.id)).toEqual(["e", "d", "c", "b"]);
    expect(selectOverdueFollowUp(rows, TODAY, 2).map((x) => x.id)).toEqual(["e", "d"]);
  });

  it("maps the display fields, passing null supplier/amount through", () => {
    const got = selectOverdueFollowUp(
      [
        row({
          id: "a",
          pr_number: 4655,
          item_description: "เหล็กเส้น DB12 ×80",
          supplier: null,
          amount: null,
          eta: "2026-06-15",
        }),
      ],
      TODAY,
    );
    expect(got).toEqual([
      {
        id: "a",
        prNumber: 4655,
        itemDescription: "เหล็กเส้น DB12 ×80",
        supplier: null,
        eta: "2026-06-15",
        amount: null,
        overdueDays: 3,
      },
    ]);
  });
});
