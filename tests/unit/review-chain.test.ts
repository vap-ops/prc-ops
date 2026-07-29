// Writing failing test first.
//
// Spec 373 §6 — the verify assembly line. Pure chain helper: given the
// pending events of ONE source (RPC order: oldest first) and the voucher the
// reviewer is standing on, pick the next door. The current voucher may itself
// still be pending (the reviewer hasn't decided yet) — it must never be its
// own "next".

import { describe, expect, it } from "vitest";

import { pickNextPending } from "@/lib/accounting/review-chain";

const ev = (id: string) => ({ source_id: id });

describe("spec 373 §6 — pickNextPending", () => {
  it("returns the oldest pending event that is not the current voucher", () => {
    expect(pickNextPending([ev("a"), ev("b"), ev("c")], "x")).toBe("a");
    expect(pickNextPending([ev("a"), ev("b"), ev("c")], "a")).toBe("b");
  });

  it("returns null when nothing else is pending (the chain's end state)", () => {
    expect(pickNextPending([], "a")).toBeNull();
    expect(pickNextPending([ev("a")], "a")).toBeNull();
  });
});
