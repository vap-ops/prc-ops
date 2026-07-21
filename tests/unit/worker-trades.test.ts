// Writing failing test first.
//
// Spec 332 U2 — pure helpers behind the roster's trade tagging (สายงาน).
// The RPC is full-replace, so the sheet needs to know whether the selection
// actually changed before spending a call, and the row needs a stable
// primary-first order for the chips.

import { describe, expect, it } from "vitest";

import {
  sortTradesPrimaryFirst,
  tradeSelectionChanged,
  type WorkerTrade,
} from "@/lib/workers/trades";

const trade = (code: string, isPrimary = false): WorkerTrade => ({
  categoryId: `id-${code}`,
  code,
  nameTh: `หมวด ${code}`,
  isPrimary,
});

describe("sortTradesPrimaryFirst", () => {
  it("puts the primary trade first", () => {
    const sorted = sortTradesPrimaryFirst([trade("W05"), trade("W01", true), trade("W03")]);
    expect(sorted.map((t) => t.code)).toEqual(["W01", "W03", "W05"]);
  });

  it("orders by code when there is no primary", () => {
    const sorted = sortTradesPrimaryFirst([trade("W05"), trade("W01"), trade("W03")]);
    expect(sorted.map((t) => t.code)).toEqual(["W01", "W03", "W05"]);
  });

  it("does not mutate the input", () => {
    const input = [trade("W05"), trade("W01", true)];
    sortTradesPrimaryFirst(input);
    expect(input.map((t) => t.code)).toEqual(["W05", "W01"]);
  });

  it("returns an empty array unchanged", () => {
    expect(sortTradesPrimaryFirst([])).toEqual([]);
  });
});

describe("tradeSelectionChanged", () => {
  const current = [trade("W01", true), trade("W03")];

  it("is false when the same set and primary come back in a different order", () => {
    expect(tradeSelectionChanged(current, ["id-W03", "id-W01"], "id-W01")).toBe(false);
  });

  it("is true when a trade is added", () => {
    expect(tradeSelectionChanged(current, ["id-W01", "id-W03", "id-W05"], "id-W01")).toBe(true);
  });

  it("is true when a trade is removed", () => {
    expect(tradeSelectionChanged(current, ["id-W01"], "id-W01")).toBe(true);
  });

  it("is true when only the primary moves", () => {
    expect(tradeSelectionChanged(current, ["id-W01", "id-W03"], "id-W03")).toBe(true);
  });

  it("is true when the primary is cleared", () => {
    expect(tradeSelectionChanged(current, ["id-W01", "id-W03"], null)).toBe(true);
  });

  it("is false for an unchanged empty selection", () => {
    expect(tradeSelectionChanged([], [], null)).toBe(false);
  });

  it("is true when the first trade is added to an untagged worker", () => {
    expect(tradeSelectionChanged([], ["id-W01"], null)).toBe(true);
  });

  it("ignores duplicate ids in the incoming selection", () => {
    expect(tradeSelectionChanged(current, ["id-W01", "id-W03", "id-W03"], "id-W01")).toBe(false);
  });
});
