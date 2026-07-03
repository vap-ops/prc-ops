// Spec 148 U3 — the schedule loader batches its independent queries. RED first:
// concurrency (max in-flight >= 3: project ∥ work_packages ∥ deliverables; serial
// peaks at 1) + shape. critical-path compute is pure and runs for real.

import { describe, it, expect, beforeEach } from "vitest";

import { loadProjectSchedule } from "@/lib/projects/load-schedule";

let inFlight = 0;
let maxInFlight = 0;

const PROJECT = { id: "p1", code: "PRJ", name: "โปร" };
const WPS = [
  {
    id: "w1",
    code: "WP-01",
    name: "งาน",
    status: "in_progress",
    deliverable_id: null,
    priority: "normal",
    planned_start: null,
    planned_end: null,
  },
];
const DELIVERABLES = [{ id: "d1", code: "D-01", name: "งวด", sort_order: 1 }];

const SINGLE: Record<string, unknown> = { projects: PROJECT };
const LIST: Record<string, unknown[]> = {
  work_packages: WPS,
  deliverables: DELIVERABLES,
  work_package_dependencies: [],
  // Spec 255 U1 — photo evidence feeds per-WP activity spans.
  photo_logs: [
    {
      id: "ph1",
      work_package_id: "w1",
      storage_path: "photos/ph1.jpg",
      superseded_by: null,
      captured_at_client: null,
      created_at: "2026-06-15T05:00:00.000Z",
    },
  ],
};

function makeQuery(table: string) {
  const q: Record<string, unknown> = { __single: false };
  for (const m of ["select", "eq", "neq", "in", "order", "limit"]) {
    q[m] = () => q;
  }
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
        return { data: q.__single ? SINGLE[table] : (LIST[table] ?? []), error: null };
      })
      .then(resolve, reject);
  };
  return q;
}

const supabase = { from: (table: string) => makeQuery(table) } as never;

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
});

describe("loadProjectSchedule", () => {
  it("runs project + work_packages + deliverables concurrently", async () => {
    await loadProjectSchedule(supabase, "p1");
    expect(maxInFlight).toBeGreaterThanOrEqual(3);
  });

  it("assembles the correct shape", async () => {
    const data = await loadProjectSchedule(supabase, "p1");
    expect(data.project?.code).toBe("PRJ");
    expect(data.workPackages).toEqual(WPS);
    expect(data.deliverables).toEqual(DELIVERABLES);
    expect(data.depRows).toEqual([]);
    expect(data.criticalIds).toBeInstanceOf(Set);
  });

  it("returns per-WP activity spans from photo_logs (spec 255)", async () => {
    const data = await loadProjectSchedule(supabase, "p1");
    expect(data.activitySpans.get("w1")).toEqual({ firstIso: "2026-06-15", lastIso: "2026-06-15" });
  });
});
