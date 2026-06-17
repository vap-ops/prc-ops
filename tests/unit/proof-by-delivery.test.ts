// Spec 135 U4 — groupProofByDelivery: a PO's proof-of-delivery docs scope to a
// delivery (งวด). New uploads carry a delivery_id; legacy proof (uploaded before U4,
// delivery_id NULL — purchase_order_attachments is append-only so it was never
// backfilled) falls under the PO's DEFAULT delivery (the earliest, งวดที่ 1). Pure →
// unit-tested.

import { describe, expect, it } from "vitest";
import { groupProofByDelivery } from "@/lib/purchasing/po-deliveries";

const doc = (id: string, delivery_id: string | null) => ({ id, delivery_id });

describe("groupProofByDelivery", () => {
  it("groups docs under their own delivery_id", () => {
    const m = groupProofByDelivery([doc("p1", "d1"), doc("p2", "d2"), doc("p3", "d1")], "d1");
    expect(m.get("d1")?.map((d) => d.id)).toEqual(["p1", "p3"]);
    expect(m.get("d2")?.map((d) => d.id)).toEqual(["p2"]);
  });

  it("assigns legacy NULL-delivery docs to the default delivery", () => {
    const m = groupProofByDelivery([doc("p1", null), doc("p2", "d2")], "d1");
    expect(m.get("d1")?.map((d) => d.id)).toEqual(["p1"]);
    expect(m.get("d2")?.map((d) => d.id)).toEqual(["p2"]);
  });

  it("preserves input order within a delivery", () => {
    const m = groupProofByDelivery([doc("a", "d1"), doc("b", null), doc("c", "d1")], "d1");
    expect(m.get("d1")?.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty map for no docs", () => {
    expect(groupProofByDelivery([], "d1").size).toBe(0);
  });

  it("drops a NULL-delivery doc when there is no default delivery", () => {
    const m = groupProofByDelivery([doc("p1", null)], null);
    expect(m.size).toBe(0);
  });
});
