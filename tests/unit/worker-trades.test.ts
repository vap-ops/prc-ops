// Writing failing test first.
//
// Spec 332 U2 — pure helpers behind the roster's trade tagging (สายงาน).
// The RPC is full-replace, so the sheet needs to know whether the selection
// actually changed before spending a call, and the row needs a stable
// primary-first order for the chips.

import { describe, expect, it } from "vitest";

import {
  foldWorkerTrades,
  sortTradesPrimaryFirst,
  tradeMismatchCode,
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

// Spec 338 U2 — fold the worker_trades join rows (as the team-map page reads
// them) into a per-worker primary-first list the view can index by chip.
describe("foldWorkerTrades", () => {
  const row = (
    workerId: string,
    code: string,
    isPrimary = false,
    cats: { code: string; name_th: string } | null = { code, name_th: `หมวด ${code}` },
  ) => ({
    worker_id: workerId,
    work_category_id: `id-${code}`,
    is_primary: isPrimary,
    work_categories: cats,
  });

  it("groups by worker with the primary trade first", () => {
    const folded = foldWorkerTrades([row("w1", "W05"), row("w2", "W03"), row("w1", "W01", true)]);
    expect(folded["w1"]?.map((t) => t.code)).toEqual(["W01", "W05"]);
    expect(folded["w1"]?.[0]?.isPrimary).toBe(true);
    expect(folded["w2"]?.map((t) => t.code)).toEqual(["W03"]);
  });

  it("skips rows whose category join came back null", () => {
    const folded = foldWorkerTrades([row("w1", "W05"), row("w1", "W02", false, null)]);
    expect(folded["w1"]?.map((t) => t.code)).toEqual(["W05"]);
  });

  it("returns an empty record for no rows", () => {
    expect(foldWorkerTrades([])).toEqual({});
  });
});

// Spec 338 U3 — the placing-hint predicate. Advisory only: it may claim a
// mismatch ONLY when it can prove one (resolvable category AND a lead with
// ≥1 trade). Every unknown → null, so the map never scolds on missing data.
describe("tradeMismatchCode", () => {
  const lead = [trade("W02", true), trade("W05")];

  it("returns the resolved top code when the lead lacks it", () => {
    expect(tradeMismatchCode("W03", lead)).toBe("W03");
  });

  it("resolves a 5-char subsection to its parent before comparing", () => {
    expect(tradeMismatchCode("W0203", lead)).toBeNull();
    expect(tradeMismatchCode("W0301", lead)).toBe("W03");
  });

  it("is null for a missing or unknown category", () => {
    expect(tradeMismatchCode(null, lead)).toBeNull();
    expect(tradeMismatchCode(undefined, lead)).toBeNull();
    expect(tradeMismatchCode("XX9", lead)).toBeNull();
  });

  it("is null when the lead has no trades (absence is not incapability)", () => {
    expect(tradeMismatchCode("W03", [])).toBeNull();
  });
});
