// Spec 147 U2 — the project-detail loader batches its independent queries.
// RED first: asserts the fan runs CONCURRENTLY (max in-flight >= 6; a serial
// waterfall would peak at 1) and assembles the right shape. Stub mirrors the U1
// loader test: a thenable whose terminal resolves on a real timer, observed via
// an in-flight counter. supabase.rpc + head/count selects are supported.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/users/display-names", () => ({
  fetchDisplayNames: vi.fn(
    async () =>
      new Map<string, string>([
        ["u1", "หัวหน้า"],
        ["u2", "สมาชิก"],
      ]),
  ),
}));

import { loadProjectDetail } from "@/lib/projects/load-detail";

let inFlight = 0;
let maxInFlight = 0;

const PROJECT = {
  id: "p1",
  code: "PRJ-01",
  name: "บ้านคุณสมชาย",
  status: "active",
  site_address: null,
  client_id: "cl1",
  project_lead_id: "u1",
  project_type: "house",
};
const CLIENT = { name: "ลูกค้า" };
const MEMBERS = [{ user_id: "u2" }];
const WORK_PACKAGES = [
  {
    id: "w1",
    code: "WP-01",
    name: "งานเสาเข็ม",
    status: "in_progress",
    deliverable_id: null,
    contractor_id: null,
    priority: "normal",
    planned_start: null,
    planned_end: null,
  },
];
const DELIVERABLES = [{ id: "d1", code: "D-01", name: "งวด 1", sort_order: 1 }];
const CATEGORIES = [
  { id: "c1", code: "STRUCT", name: "งานโครงสร้าง", sort_order: 1, is_active: true },
];
const SOURCE_PROJECTS = [{ id: "p2", code: "PRJ-02", name: "โครงการอื่น" }];
const ONBOARDING = [
  {
    dates_lead_set: true,
    budget_set: false,
    team_added: true,
    work_packages_added: true,
    client_set: true,
    dismissed: false,
  },
];

const SINGLE: Record<string, unknown> = { clients: CLIENT };
const LIST: Record<string, unknown[]> = {
  project_members: MEMBERS,
  work_packages: WORK_PACKAGES,
  deliverables: DELIVERABLES,
  project_categories: CATEGORIES,
  projects: SOURCE_PROJECTS,
  work_package_dependencies: [],
};
const COUNT: Record<string, number> = {};
const RPC: Record<string, unknown> = { project_onboarding_status: ONBOARDING };

function track<T>(value: T): Promise<T> {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  return new Promise((r) => setTimeout(r, 5)).then(() => {
    inFlight--;
    return value;
  });
}

function makeQuery(table: string) {
  const q: Record<string, unknown> = { __single: false };
  for (const m of ["select", "eq", "neq", "in", "order", "limit"]) {
    q[m] = () => q;
  }
  q.maybeSingle = () => {
    q.__single = true;
    return q;
  };
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    track({
      data: q.__single ? SINGLE[table] : (LIST[table] ?? []),
      count: COUNT[table] ?? null,
      error: null,
    }).then(resolve, reject);
  return q;
}

const supabase = {
  from: (table: string) => makeQuery(table),
  rpc: (name: string) => track({ data: RPC[name] ?? null, error: null }),
} as never;

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
});

describe("loadProjectDetail", () => {
  it("runs the independent fan concurrently (not a serial waterfall)", async () => {
    await loadProjectDetail(supabase, PROJECT as never, true);
    // clients + project_members + work_packages + deliverables + project_categories
    // + onboarding + projects = 7 reads that depend only on the project → overlap.
    expect(maxInFlight).toBeGreaterThanOrEqual(7);
  });

  it("assembles the correct shape (PM role)", async () => {
    const data = await loadProjectDetail(supabase, PROJECT as never, true);
    expect(data.clientName).toBe("ลูกค้า");
    expect(data.leadName).toBe("หัวหน้า");
    expect(data.memberNames).toEqual(["สมาชิก"]);
    expect(data.workPackages).toEqual(WORK_PACKAGES);
    expect(data.deliverables).toEqual(DELIVERABLES);
    expect(data.categories).toEqual(CATEGORIES);
    expect(data.criticalIds).toBeInstanceOf(Set);
    expect(data.onboarding?.work_packages_added).toBe(true);
    expect(data.sourceProjects).toEqual(SOURCE_PROJECTS);
  });

  it("skips the PM-only reads when not a PM", async () => {
    const data = await loadProjectDetail(supabase, PROJECT as never, false);
    expect(data.onboarding).toBeNull();
    expect(data.sourceProjects).toEqual([]);
    // non-PM still gets the core project context + worklist data
    expect(data.workPackages).toEqual(WORK_PACKAGES);
    expect(data.clientName).toBe("ลูกค้า");
  });
});
