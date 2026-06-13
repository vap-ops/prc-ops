// Spec 68 P2 — pure cost aggregation over labor_logs rows read via the
// admin client (money columns present). These helpers compute what the
// PM cost view renders and what freeze_wp_labor_cost stores; the SQL RPC
// and this TS must agree (own = Σ fraction×rate for own workers, dc
// likewise). Current-state filter (supersede anti-join + tombstone) is
// applied inside, so callers pass raw rows.

import { describe, it, expect } from "vitest";
import {
  aggregateLaborCost,
  currentLaborPairKeys,
  findOverAllocatedDays,
  fractionDays,
  type CostInputRow,
} from "@/lib/labor/cost";

function row(overrides: Partial<CostInputRow>): CostInputRow {
  return {
    id: "r1",
    worker_id: "w1",
    work_date: "2026-06-10",
    day_fraction: "full",
    day_rate_snapshot: 500,
    worker_type_snapshot: "own",
    worker_name_snapshot: "ช่าง ก",
    self_logged: false,
    superseded_by: null,
    ...overrides,
  };
}

describe("fractionDays", () => {
  it("full = 1, half = 0.5", () => {
    expect(fractionDays("full")).toBe(1);
    expect(fractionDays("half")).toBe(0.5);
  });
});

describe("aggregateLaborCost", () => {
  it("splits own vs dc subtotals and totals them", () => {
    const s = aggregateLaborCost([
      row({
        id: "a",
        worker_id: "w1",
        worker_type_snapshot: "own",
        day_rate_snapshot: 500,
        day_fraction: "full",
      }),
      row({
        id: "b",
        worker_id: "w2",
        worker_type_snapshot: "dc",
        day_rate_snapshot: 380,
        day_fraction: "full",
      }),
    ]);
    expect(s.ownCost).toBe(500);
    expect(s.dcCost).toBe(380);
    expect(s.total).toBe(880);
  });

  it("applies the day fraction to the rate", () => {
    const s = aggregateLaborCost([
      row({ id: "a", day_fraction: "half", day_rate_snapshot: 500, worker_type_snapshot: "own" }),
    ]);
    expect(s.ownCost).toBe(250);
  });

  it("excludes superseded and tombstone rows", () => {
    const s = aggregateLaborCost([
      row({ id: "orig", worker_id: "w1", day_rate_snapshot: 500 }),
      row({
        id: "corr",
        worker_id: "w1",
        superseded_by: "orig",
        day_fraction: "half",
        day_rate_snapshot: 500,
      }),
      row({
        id: "tomb",
        worker_id: "w2",
        worker_type_snapshot: "dc",
        day_fraction: null,
        superseded_by: "x",
        day_rate_snapshot: 380,
      }),
    ]);
    // orig superseded → use corr (half×500=250); tomb excluded.
    expect(s.ownCost).toBe(250);
    expect(s.dcCost).toBe(0);
  });

  it("rolls a worker's multiple days into one line with summed days and cost", () => {
    const s = aggregateLaborCost([
      row({
        id: "a",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "full",
        day_rate_snapshot: 500,
      }),
      row({
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-11",
        day_fraction: "half",
        day_rate_snapshot: 500,
      }),
    ]);
    expect(s.workers).toHaveLength(1);
    expect(s.workers[0]?.days).toBe(1.5);
    expect(s.workers[0]?.cost).toBe(750);
  });

  it("honours each row's own rate snapshot (mid-stream rate change)", () => {
    const s = aggregateLaborCost([
      row({ id: "a", worker_id: "w1", day_fraction: "full", day_rate_snapshot: 500 }),
      row({
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-11",
        day_fraction: "full",
        day_rate_snapshot: 600,
      }),
    ]);
    expect(s.workers[0]?.cost).toBe(1100);
  });

  it("rolls self_logged true if any of a worker's rows are self-logged", () => {
    const s = aggregateLaborCost([
      row({ id: "a", worker_id: "w1", self_logged: false }),
      row({ id: "b", worker_id: "w1", work_date: "2026-06-11", self_logged: true }),
    ]);
    expect(s.workers[0]?.selfLogged).toBe(true);
  });

  it("returns distinct sorted labor days", () => {
    const s = aggregateLaborCost([
      row({ id: "a", work_date: "2026-06-11" }),
      row({ id: "b", worker_id: "w2", work_date: "2026-06-10" }),
      row({ id: "c", worker_id: "w3", work_date: "2026-06-11" }),
    ]);
    expect(s.laborDays).toEqual(["2026-06-10", "2026-06-11"]);
  });

  it("is empty for no rows", () => {
    const s = aggregateLaborCost([]);
    expect(s).toEqual({ ownCost: 0, dcCost: 0, total: 0, workers: [], laborDays: [] });
  });
});

describe("findOverAllocatedDays (C5 cross-WP over-allocation)", () => {
  it("flags a worker over 1.0 on a date across WPs", () => {
    const over = findOverAllocatedDays([
      {
        id: "a",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "full",
        superseded_by: null,
      },
      {
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "half",
        superseded_by: null,
      },
    ]);
    expect(over).toEqual([{ workerId: "w1", workDate: "2026-06-10", totalDays: 1.5 }]);
  });

  it("does NOT flag exactly 1.0", () => {
    const over = findOverAllocatedDays([
      {
        id: "a",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "half",
        superseded_by: null,
      },
      {
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "half",
        superseded_by: null,
      },
    ]);
    expect(over).toEqual([]);
  });

  it("ignores superseded and tombstone rows in the sum", () => {
    const over = findOverAllocatedDays([
      {
        id: "a",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "full",
        superseded_by: null,
      },
      {
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "full",
        superseded_by: "a",
      },
      { id: "c", worker_id: "w1", work_date: "2026-06-10", day_fraction: null, superseded_by: "z" },
    ]);
    // Only row a is current → 1.0, not over.
    expect(over).toEqual([]);
  });

  it("separates distinct workers and dates", () => {
    const over = findOverAllocatedDays([
      {
        id: "a",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "full",
        superseded_by: null,
      },
      {
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "full",
        superseded_by: null,
      },
      {
        id: "c",
        worker_id: "w2",
        work_date: "2026-06-10",
        day_fraction: "full",
        superseded_by: null,
      },
    ]);
    expect(over).toEqual([{ workerId: "w1", workDate: "2026-06-10", totalDays: 2 }]);
  });
});

describe("currentLaborPairKeys", () => {
  it("keys current rows by worker|date, excluding superseded and tombstones", () => {
    const keys = currentLaborPairKeys([
      {
        id: "a",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "full",
        superseded_by: null,
      },
      {
        id: "b",
        worker_id: "w1",
        work_date: "2026-06-10",
        day_fraction: "half",
        superseded_by: "a",
      },
      { id: "c", worker_id: "w2", work_date: "2026-06-11", day_fraction: null, superseded_by: "z" },
    ]);
    // a superseded by b (current), c is a tombstone.
    expect([...keys]).toEqual(["w1|2026-06-10"]);
  });
});
