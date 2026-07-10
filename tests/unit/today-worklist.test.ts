// Writing failing test first.
//
// Perf (RUM-aimed TTFB, 2026-07-10): /sa is the worst mobile route (RES75) and its
// แผนวันนี้ worklist is the default surface. The worklist assembly ran 5 serial reads
// (plan_items → crew → labels → workers → labor); labels/workers/labor are mutually
// independent (they key only off the plan-item / crew id-lists), so buildTodayWorklist
// fires them in ONE Promise.all wave. This test PINS the assembled WorklistItem[]
// (present-set, crew, category code, project label) so the reorder stays behaviour-
// identical. `currentLaborLogs` runs for real (present-detection is its job).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildTodayWorklist } from "@/lib/sa/today-worklist";

type Row = Record<string, unknown>;

// Fake PostgREST client keyed by TABLE (each table is read once in buildTodayWorklist).
function fakeClient(fixtures: Record<string, Row[]>) {
  const from = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: fixtures[table] ?? [], error: null }),
    };
    return b;
  };
  return { from } as never;
}

const PLANS = [{ id: "plan1", project_id: "projA" }];
const PLAN_PROJECT = new Map([["plan1", "projA"]]);
const PROJECTS_BY_ID = new Map([["projA", { code: "PA", name: "Alpha" }]]);
const CATEGORY_CODE_BY_ID = new Map([["catX", "W01"]]);
const TODAY = "2026-07-10";

const FIXTURES: Record<string, Row[]> = {
  daily_work_plan_items: [
    { id: "it1", plan_id: "plan1", work_package_id: "wp1", sort_order: 1 },
    { id: "it2", plan_id: "plan1", work_package_id: "wp2", sort_order: 2 },
  ],
  daily_work_plan_crew: [
    { item_id: "it1", worker_id: "wk1", is_lead: true },
    { item_id: "it1", worker_id: "wk2", is_lead: false },
    { item_id: "it2", worker_id: "wk1", is_lead: true },
  ],
  work_packages: [
    { id: "wp1", code: "WP-1", name: "Foundation", category_id: "catX" },
    { id: "wp2", code: "WP-2", name: "Framing", category_id: null },
  ],
  workers: [
    { id: "wk1", name: "Somchai" },
    { id: "wk2", name: "Nid" },
  ],
  labor_logs: [
    {
      id: "l1",
      work_package_id: "wp1",
      worker_id: "wk1",
      work_date: TODAY,
      day_fraction: 1,
      worker_name_snapshot: "Somchai",
      pay_type_snapshot: "daily",
      entered_by: "u1",
      self_logged: false,
      superseded_by: null,
      correction_reason: null,
      created_at: "2026-07-10T08:00:00Z",
      note: null,
    },
  ],
};

function run(overrides: Partial<Parameters<typeof buildTodayWorklist>[0]> = {}) {
  return buildTodayWorklist({
    supabase: fakeClient(FIXTURES),
    plans: PLANS,
    planProject: PLAN_PROJECT,
    projectsById: PROJECTS_BY_ID,
    categoryCodeById: CATEGORY_CODE_BY_ID,
    multiProject: false,
    today: TODAY,
    ...overrides,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("buildTodayWorklist", () => {
  it("returns [] when there is no board today", async () => {
    expect(await run({ plans: [] })).toEqual([]);
  });

  it("assembles each plan item with labels, crew and today's present-set", async () => {
    const items = await run();
    expect(items).toHaveLength(2);

    const [it1, it2] = items;
    // it1 — labelled WP with category code, two crew, wk1 present (logged today).
    expect(it1).toMatchObject({
      id: "it1",
      workPackageId: "wp1",
      code: "WP-1",
      name: "Foundation",
      categoryCode: "W01",
    });
    expect(it1!.crew).toEqual([
      { workerId: "wk1", name: "Somchai", present: true },
      { workerId: "wk2", name: "Nid", present: false },
    ]);
    // no projectLabel in single-project mode
    expect("projectLabel" in it1!).toBe(false);

    // it2 — WP with null category → no code; wk1 not present on wp2.
    expect(it2).toMatchObject({
      id: "it2",
      workPackageId: "wp2",
      code: "WP-2",
      categoryCode: null,
    });
    expect(it2!.crew).toEqual([{ workerId: "wk1", name: "Somchai", present: false }]);
  });

  it("adds a project label per item when the SA spans multiple projects", async () => {
    const [it1] = await run({ multiProject: true });
    expect(it1).toMatchObject({ projectLabel: "PA" });
  });
});
