// Spec 135 U3 — deliverySplitWouldEmptySource: the client-side mirror of the RPC's
// non-empty guard. A delivery must keep >= 1 active line, so a split may not move
// every active line out of a source delivery. The RPC re-enforces this server-side;
// this pure helper lets the sheet disable submit with a clear hint (the "clear inline
// message beats the generic failure" posture).

import { describe, expect, it } from "vitest";
import { deliverySplitWouldEmptySource } from "@/lib/purchasing/po-deliveries";

describe("deliverySplitWouldEmptySource", () => {
  it("is false for an empty selection", () => {
    expect(deliverySplitWouldEmptySource([], { d1: 3 })).toBe(false);
  });

  it("is false when the source keeps at least one active line", () => {
    expect(
      deliverySplitWouldEmptySource([{ delivery_id: "d1" }, { delivery_id: "d1" }], { d1: 3 }),
    ).toBe(false);
  });

  it("is true when every active line of a delivery would move out", () => {
    expect(
      deliverySplitWouldEmptySource([{ delivery_id: "d1" }, { delivery_id: "d1" }], { d1: 2 }),
    ).toBe(true);
  });

  it("is true if any one source delivery would be emptied (multi-source)", () => {
    expect(
      deliverySplitWouldEmptySource(
        [{ delivery_id: "d1" }, { delivery_id: "d2" }],
        { d1: 3, d2: 1 }, // d2 has only this one active line
      ),
    ).toBe(true);
  });

  it("ignores lines with no delivery", () => {
    expect(deliverySplitWouldEmptySource([{ delivery_id: null }], { d1: 1 })).toBe(false);
  });
});
