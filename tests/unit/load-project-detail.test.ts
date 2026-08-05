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
    // Spec 392 U3a — the zone axis rides the same read the worklist already does.
    zone_id: "z1",
  },
];
const ZONES = [
  {
    id: "z1",
    map_id: "m1",
    code: "A",
    name: "พื้นลานด้านซ้าย",
    shape: "rect",
    sort_order: 0,
    parent_zone_id: null,
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
  project_zones: ZONES,
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
    // + project_zones + onboarding + projects = 8 reads that depend only on the
    // project → overlap. Spec 392 U3a added project_zones to the SAME wave: the
    // rollup must not cost the app's highest-traffic mobile route a serial layer.
    expect(maxInFlight).toBeGreaterThanOrEqual(8);
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

  it("selects the zone column and returns the project's zones (spec 392 U3a)", async () => {
    const data = await loadProjectDetail(supabase, PROJECT as never, true);
    expect(selectedColumns["work_packages"]).toContain("zone_id");
    // Returned in the zone-list's own input shape so the rollup and the list can
    // share one ordering helper instead of two remappings.
    expect(data.zones).toEqual([
      {
        id: "z1",
        code: "A",
        name: "พื้นลานด้านซ้าย",
        shape: "rect",
        sortOrder: 0,
        parentZoneId: null,
      },
    ]);
  });

  it("returns no zones for a reader RLS withholds them from — not an error, an empty grid", async () => {
    // project_zones SELECT is `procurement/procurement_manager OR
    // can_see_project`; a reader outside both gets zero rows, and the surface
    // must degrade to nothing rather than to a broken page.
    const withheld = {
      from: (table: string) => makeQuery(table === "project_zones" ? "__empty__" : table),
      rpc: (name: string) => track({ data: RPC[name] ?? null, error: null }),
    } as never;
    const data = await loadProjectDetail(withheld, PROJECT as never, true);
    expect(data.zones).toEqual([]);
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
