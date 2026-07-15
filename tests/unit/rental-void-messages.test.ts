// Writing failing test first.
//
// Spec 312 follow-up 2 — the void RB409 signpost. void_equipment_rental_batch
// (mig 075799) raises THREE distinct RB409 messages: a live (nonzero) settlement
// still attached, a charge attached, or a non-active batch. The old action
// collapsed all three into one vague string; this pure mapper turns the DB
// message into cause-specific Thai copy so the user is told WHAT to unwind first
// (zero the settlement · cancel the charge). Matching is on the stable message
// fragments the migration ships — a future reword breaks these tests on purpose.

import { describe, expect, it } from "vitest";

import {
  VOID_BLOCKED_BY_CHARGES,
  VOID_BLOCKED_BY_SETTLEMENT,
  VOID_CANNOT,
  VOID_NOT_ACTIVE,
  voidRb409Message,
} from "@/lib/equipment/rental-void-messages";

describe("voidRb409Message (spec 312 follow-up)", () => {
  it("maps a live-settlement block to the settlement signpost", () => {
    expect(voidRb409Message("void_equipment_rental_batch: batch has a live settlement")).toBe(
      VOID_BLOCKED_BY_SETTLEMENT,
    );
  });

  it("maps a charges block to the charges message", () => {
    expect(voidRb409Message("void_equipment_rental_batch: batch has charges")).toBe(
      VOID_BLOCKED_BY_CHARGES,
    );
  });

  it("maps a non-active batch to the already-cancelled message", () => {
    expect(
      voidRb409Message("void_equipment_rental_batch: only an active batch can be voided"),
    ).toBe(VOID_NOT_ACTIVE);
  });

  it("falls back to a STATE-NEUTRAL message for an unknown/blank RB409, never a false state", () => {
    // A reworded or future RB409 cause must not be mislabeled "already
    // cancelled" (VOID_NOT_ACTIVE asserts a concrete state) — it gets the
    // neutral generic instead.
    expect(voidRb409Message(undefined)).toBe(VOID_CANNOT);
    expect(voidRb409Message("")).toBe(VOID_CANNOT);
    expect(voidRb409Message("some unrelated future RB409 cause")).toBe(VOID_CANNOT);
  });

  it("the settlement signpost names the settlement section and the zero step", () => {
    // It must actually tell the user where to go and what to do — the whole
    // point of the fix. The section name is the shared history label.
    expect(VOID_BLOCKED_BY_SETTLEMENT).toContain("ประวัติการชำระ");
    expect(VOID_BLOCKED_BY_SETTLEMENT).toContain("0");
  });
});
