// Spec 149 U2 §Tests (TDD, RED first) — pure helpers for accounting periods
// (ADR 0057 decision 7). `firstOfMonth` normalizes an ISO date to the first of
// its month (no Date parsing — string slice); `canTransitionPeriod` mirrors the
// DB's legal-transition table for the UI (the set_accounting_period_status RPC
// is the real guard, incl. the super-only lock/reopen).

import { describe, it, expect } from "vitest";
import { firstOfMonth, canTransitionPeriod } from "@/lib/accounting/period";

describe("firstOfMonth", () => {
  it("normalizes a mid-month date to the first", () => {
    expect(firstOfMonth("2026-06-19")).toBe("2026-06-01");
  });
  it("is idempotent on a first-of-month date", () => {
    expect(firstOfMonth("2026-06-01")).toBe("2026-06-01");
  });
  it("handles the last day of the month", () => {
    expect(firstOfMonth("2026-12-31")).toBe("2026-12-01");
  });
});

describe("canTransitionPeriod", () => {
  it("allows open -> closing without super", () => {
    expect(canTransitionPeriod("open", "closing", false)).toBe(true);
  });
  it("allows closing -> closed without super", () => {
    expect(canTransitionPeriod("closing", "closed", false)).toBe(true);
  });
  it("allows closing -> open (reopen the reconciliation window)", () => {
    expect(canTransitionPeriod("closing", "open", false)).toBe(true);
  });
  it("requires super to lock a closed period", () => {
    expect(canTransitionPeriod("closed", "locked", false)).toBe(false);
    expect(canTransitionPeriod("closed", "locked", true)).toBe(true);
  });
  it("requires super to reopen a closed period", () => {
    expect(canTransitionPeriod("closed", "open", false)).toBe(false);
    expect(canTransitionPeriod("closed", "open", true)).toBe(true);
  });
  it("never transitions out of locked, even for super", () => {
    expect(canTransitionPeriod("locked", "open", true)).toBe(false);
    expect(canTransitionPeriod("locked", "closed", true)).toBe(false);
  });
  it("rejects an illegal jump (open -> closed)", () => {
    expect(canTransitionPeriod("open", "closed", true)).toBe(false);
  });
  it("rejects a no-op (same status)", () => {
    expect(canTransitionPeriod("open", "open", true)).toBe(false);
  });
  it("rejects an unknown status", () => {
    expect(canTransitionPeriod("open", "frozen", true)).toBe(false);
  });
});
