// Spec 363 U4 slice 2 — the `ของ` tab's one state-grouped list.
//
// Grouping is the whole logic of the unit, so it lives in a pure function and is
// tested over the COMPLETE purchase_request_status domain: a status added later
// must trip this guard rather than silently vanish from the SA's list.
//
// Group set locked with the operator 2026-07-27 against live counts (170
// provenance-linked requests on the pilot): the spec's three groups left
// `delivered` — 131 of those 170 — in no group at all, because store-first
// doctrine sends a delivered request to the STORE, not to the WP. It gets its
// own มาถึงคลังแล้ว group ("you asked for it, it has landed, go เบิก it"), and
// closed requests get a collapsed ปิดแล้ว group so "what happened to my ขอซื้อ"
// is answerable without leaving the WP.

import { describe, it, expect } from "vitest";

import { groupWpThings, WP_THING_GROUPS, type WpThingGroupKey } from "@/lib/work-packages/things";
import type { PurchaseRequestStatus } from "@/lib/db/enums";

// The live enum, 2026-07-27. Spec §D5 said `requested · approved · shipped` —
// `shipped` DOES NOT EXIST; the not-yet-arrived set is requested/approved/
// purchased/on_route. Iterating the full domain is what caught that.
const ALL_STATUSES: PurchaseRequestStatus[] = [
  "requested",
  "approved",
  "rejected",
  "cancelled",
  "purchased",
  "on_route",
  "delivered",
  "site_purchased",
];

function req(status: PurchaseRequestStatus, over: Partial<{ id: string }> = {}) {
  return {
    id: over.id ?? `r-${status}`,
    prNumber: 1,
    itemDescription: "ปูน",
    quantity: 2,
    unit: "ถุง",
    status,
    requestedAt: "2026-07-01T00:00:00Z",
  };
}

function issue(over: Partial<{ id: string; qty: number; returnedQty: number }> = {}) {
  return {
    id: over.id ?? "i1",
    baseItem: "สายไฟ",
    specAttrs: null,
    unit: "ม้วน",
    qty: over.qty ?? 5,
    returnedQty: over.returnedQty ?? 0,
    issuedAt: "2026-07-02T00:00:00Z",
  };
}

describe("groupWpThings (spec 363 U4 slice 2)", () => {
  it("puts every purchase_request_status in exactly one group", () => {
    const groups = groupWpThings({
      requests: ALL_STATUSES.map((s) => req(s)),
      issues: [],
    });
    const placed = groups.flatMap((g) => g.rows.map((r) => r.id));
    for (const s of ALL_STATUSES) {
      expect(placed.filter((id) => id === `r-${s}`)).toHaveLength(1);
    }
  });

  it("groups the not-yet-arrived statuses under รออนุมัติ", () => {
    const groups = groupWpThings({
      requests: (["requested", "approved", "purchased", "on_route"] as const).map((s) => req(s)),
      issues: [],
    });
    const g = groups.find((x) => x.key === "awaiting");
    expect(g?.rows.map((r) => r.id).sort()).toEqual([
      "r-approved",
      "r-on_route",
      "r-purchased",
      "r-requested",
    ]);
  });

  it("gives delivered its own group — it is at the store, not at this WP", () => {
    const groups = groupWpThings({ requests: [req("delivered")], issues: [] });
    expect(groups.find((g) => g.key === "at_store")?.rows.map((r) => r.id)).toEqual([
      "r-delivered",
    ]);
    expect(groups.find((g) => g.key === "here")?.rows).toEqual([]);
  });

  it("counts a still-held issue as อยู่ที่งานนี้", () => {
    const groups = groupWpThings({
      requests: [],
      issues: [issue({ id: "i-held", qty: 5, returnedQty: 0 })],
    });
    expect(groups.find((g) => g.key === "here")?.rows.map((r) => r.id)).toEqual(["i-held"]);
  });

  it("shows a partly-returned issue in BOTH here and คืนแล้ว", () => {
    // 3 of 5 returned: 2 are still on site AND 3 came back. Dropping either
    // reading would misstate what the WP holds.
    const groups = groupWpThings({
      requests: [],
      issues: [issue({ id: "i-part", qty: 5, returnedQty: 3 })],
    });
    expect(groups.find((g) => g.key === "here")?.rows.map((r) => r.id)).toEqual(["i-part"]);
    expect(groups.find((g) => g.key === "returned")?.rows.map((r) => r.id)).toEqual(["i-part"]);
  });

  it("drops a fully-returned issue out of อยู่ที่งานนี้", () => {
    const groups = groupWpThings({
      requests: [],
      issues: [issue({ id: "i-all", qty: 5, returnedQty: 5 })],
    });
    expect(groups.find((g) => g.key === "here")?.rows).toEqual([]);
    expect(groups.find((g) => g.key === "returned")?.rows.map((r) => r.id)).toEqual(["i-all"]);
  });

  it("treats a self-purchase as already here, not as awaiting", () => {
    const groups = groupWpThings({ requests: [req("site_purchased")], issues: [] });
    expect(groups.find((g) => g.key === "here")?.rows.map((r) => r.id)).toEqual([
      "r-site_purchased",
    ]);
    expect(groups.find((g) => g.key === "awaiting")?.rows).toEqual([]);
  });

  it("collapses closed requests into ปิดแล้ว", () => {
    const groups = groupWpThings({
      requests: [req("rejected"), req("cancelled")],
      issues: [],
    });
    const g = groups.find((x) => x.key === "closed");
    expect(g?.rows.map((r) => r.id).sort()).toEqual(["r-cancelled", "r-rejected"]);
    expect(g?.collapsed).toBe(true);
  });

  it("orders the groups by what the SA acts on first", () => {
    expect(WP_THING_GROUPS.map((g) => g.key)).toEqual([
      "awaiting",
      "at_store",
      "here",
      "returned",
      "closed",
    ]);
  });

  it("collapses only the two retrospective groups", () => {
    const groups = groupWpThings({ requests: [], issues: [] });
    const collapsed = groups.filter((g) => g.collapsed).map((g) => g.key);
    expect(collapsed).toEqual<WpThingGroupKey[]>(["returned", "closed"]);
  });

  it("returns every group even when empty, so the shape is stable", () => {
    const groups = groupWpThings({ requests: [], issues: [] });
    expect(groups).toHaveLength(5);
    expect(groups.every((g) => g.rows.length === 0)).toBe(true);
  });
});
