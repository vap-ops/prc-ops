// Spec 289 U2 — fetchWpLaborBudgetSummary's two reads (labor_logs cost rows,
// wp_economics budget) are independent (both keyed on work_package_id only), so
// they must run CONCURRENTLY. RED first: the serial version peaks at 1 in-flight.

import { describe, it, expect, vi, beforeEach } from "vitest";

let inFlight = 0;
let maxInFlight = 0;

const DATA: Record<string, unknown> = {
  labor_logs: [
    {
      id: "l1",
      worker_id: "w1",
      work_date: "2026-07-01",
      day_fraction: "full",
      day_rate_snapshot: 500,
      pay_type_snapshot: "daily",
      worker_name_snapshot: "สมชาย",
      self_logged: false,
      superseded_by: null,
    },
  ],
  wp_economics: { labor_budget: 10000 },
};

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = { __single: false };
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = () => {
        q.__single = true;
        return q;
      };
      q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((r) => setTimeout(r, 5))
          .then(() => {
            inFlight--;
            const data = q.__single ? DATA[table] : [DATA[table]].flat();
            return { data, error: null };
          })
          .then(resolve, reject);
      };
      return q;
    },
  }),
}));

import { fetchWpLaborBudgetSummary } from "@/lib/labor/wp-budget-summary";

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
});

describe("fetchWpLaborBudgetSummary", () => {
  it("runs the cost and budget reads concurrently", async () => {
    await fetchWpLaborBudgetSummary("wp1");
    expect(maxInFlight).toBe(2);
  });

  it("still assembles the summary from both reads", async () => {
    const summary = await fetchWpLaborBudgetSummary("wp1");
    expect(summary.budget).toBe(10000);
    expect(summary.spend).toBe(500);
  });
});
