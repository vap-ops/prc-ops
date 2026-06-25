// Writing failing test first.
//
// Spec 202 U2 — splitEquipmentUsage: the supersede anti-join + open/history
// partition for the WP อุปกรณ์ tab. A check-in inserts a CLOSED successor whose
// superseded_by points at the OPEN row it closes (the labor_logs / photo_logs
// shape). Current state = rows NOT superseded by a newer row; open = current with
// no check-in date, history = current with one. No money here (rate-free).

import { describe, it, expect } from "vitest";
import { splitEquipmentUsage, type EquipmentUsageRow } from "@/lib/equipment/usage-rows";

const row = (over: Partial<EquipmentUsageRow> & { id: string }): EquipmentUsageRow => ({
  item_id: "e1",
  checked_out_on: "2026-07-01",
  checked_in_on: null,
  superseded_by: null,
  ...over,
});

describe("splitEquipmentUsage", () => {
  it("surfaces an open (not-superseded, not-checked-in) span under open", () => {
    const { open, history } = splitEquipmentUsage([row({ id: "o1" })]);
    expect(open.map((r) => r.id)).toEqual(["o1"]);
    expect(history).toEqual([]);
  });

  it("a checked-in span shows the closed successor in history, not the superseded open row", () => {
    // o1 was the open row; the check-in inserts the closed successor c1 whose
    // superseded_by points BACK at o1 (the RPC's supersede direction).
    const rows = [
      row({ id: "o1" }),
      row({ id: "c1", checked_in_on: "2026-07-05", superseded_by: "o1" }),
    ];
    const { open, history } = splitEquipmentUsage(rows);
    expect(open).toEqual([]);
    expect(history.map((r) => r.id)).toEqual(["c1"]);
    expect(history[0]!.checkedInOn).toBe("2026-07-05");
  });

  it("excludes a row that has been superseded even if it is still open", () => {
    // A re-checkout correction: o2 supersedes o1 (o2.superseded_by = o1); o1 is stale.
    const rows = [
      row({ id: "o1" }),
      row({ id: "o2", checked_out_on: "2026-07-02", superseded_by: "o1" }),
    ];
    const { open } = splitEquipmentUsage(rows);
    expect(open.map((r) => r.id)).toEqual(["o2"]);
  });

  it("orders open oldest-checkout-first and history most-recent-first", () => {
    const rows = [
      row({ id: "a", checked_out_on: "2026-07-03" }),
      row({ id: "b", checked_out_on: "2026-07-01" }),
      row({ id: "h1", checked_out_on: "2026-06-10", checked_in_on: "2026-06-12" }),
      row({ id: "h2", checked_out_on: "2026-06-20", checked_in_on: "2026-06-22" }),
    ];
    const { open, history } = splitEquipmentUsage(rows);
    expect(open.map((r) => r.id)).toEqual(["b", "a"]);
    expect(history.map((r) => r.id)).toEqual(["h2", "h1"]);
  });
});
