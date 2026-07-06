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
    is_group: false,
    parent_id: null,
  },
  // Spec 271 U2a: a งาน + a dated งานย่อย with timely labor evidence — planned
  // window far in the past so the derived class is deterministically `late`.
  {
    id: "g1",
    code: "WP-90",
    name: "งานกลุ่ม",
    status: "in_progress",
    deliverable_id: null,
    contractor_id: null,
    priority: "normal",
    planned_start: null,
    planned_end: null,
    is_group: true,
    parent_id: null,
  },
  {
    id: "w2",
    code: "WP-90-01",
    name: "งานย่อยใต้กลุ่ม",
    status: "in_progress",
    deliverable_id: null,
    contractor_id: null,
    priority: "normal",
    planned_start: "2020-01-01",
    planned_end: "2020-01-02",
    is_group: false,
    parent_id: "g1",
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
  // Spec 271 U2a evidence feeds (leaf-scoped .in reads in the dependent tail).
  photo_logs: [],
  labor_logs: [
    { work_package_id: "w2", work_date: "2020-01-01", created_at: "2020-01-02T03:00:00Z" },
  ],
  approvals: [],
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

const selectedColumns: Record<string, string> = {};

function makeQuery(table: string) {
  const q: Record<string, unknown> = { __single: false };
  for (const m of ["select", "eq", "neq", "in", "order", "limit"]) {
    q[m] = (arg?: unknown) => {
      if (m === "select" && typeof arg === "string") selectedColumns[table] = arg;
      return q;
    };
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

  it("selects the hierarchy columns on work_packages (spec 270 U3)", async () => {
    await loadProjectDetail(supabase, PROJECT as never, true);
    expect(selectedColumns["work_packages"]).toContain("is_group");
    expect(selectedColumns["work_packages"]).toContain("parent_id");
  });

  it("computes the per-งาน variance pill off the evidence rows (spec 271 U2a)", async () => {
    const data = await loadProjectDetail(supabase, PROJECT as never, true);
    const pill = data.variancePillByGroup["g1"];
    expect(pill).toBeDefined();
    // Started (timely labor in 2020) + far past its planned end → late, full coverage.
    expect(pill?.worst).toBe("late");
    expect(pill?.counts.late).toBe(1);
    expect(pill?.coveragePct).toBe(100);
    expect(pill?.lowCoverage).toBe(false);
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
