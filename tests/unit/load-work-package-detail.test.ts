// Spec 147 U1 — the WP-detail loader batches its independent queries.
// RED first: asserts the fan runs CONCURRENTLY (max in-flight >= 5; a serial
// waterfall would peak at 1) and assembles the right shape. The supabase stub
// is a thenable whose terminal resolves on a real timer, so overlapping awaits
// are observable via an in-flight counter.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Sub-loaders are exercised elsewhere; here they're trivial async stubs so the
// test isolates the loader's own orchestration.
vi.mock("@/lib/labor/fetch-zone-data", () => ({
  fetchLaborZoneData: vi.fn(async () => ({
    roster: { groups: [] },
    projectWorkerIds: [],
    projectWorkers: [{ id: "w1", name: "สมชาย" }],
    rows: [],
  })),
}));
const EMPTY_BY_PHASE = { before: [], during: [], after: [], after_fix: [], defect: [] };
vi.mock("@/lib/photos/current-photos", () => ({
  // Spec 341 U1 — the WP detail reads BOTH derivations off one photo_logs fetch.
  getPhotoViewForWorkPackage: vi.fn(async () => ({
    current: { ...EMPTY_BY_PHASE },
    removed: { ...EMPTY_BY_PHASE },
  })),
}));
vi.mock("@/lib/photos/signed-urls", () => ({
  mintSignedUrlsForPhotos: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/users/display-names", () => ({
  fetchDisplayNames: vi.fn(async () => new Map<string, string>([["u1", "ชื่อ"]])),
}));

import { loadWorkPackageDetail } from "@/lib/work-packages/load-detail";
import { getPhotoViewForWorkPackage } from "@/lib/photos/current-photos";
import { fetchDisplayNames } from "@/lib/users/display-names";

// --- in-flight-tracking supabase stub ---
let inFlight = 0;
let maxInFlight = 0;

const WP_ROW = {
  id: "wp1",
  code: "WP-01",
  name: "งานเสาเข็ม",
  status: "in_progress",
  project_id: "proj1",
  description: null,
  contractor_id: "c1",
  notes: null,
  priority: "normal",
  planned_start: null,
  planned_end: null,
};
const CONTRACTORS = [{ id: "c1", name: "ผู้รับเหมา", phone: "08", status: "active" }];
const APPROVALS = [
  { id: "a1", decision: "approved", comment: null, decided_by: "u1", decided_at: "2026-06-01" },
];
const REQUESTS = [
  {
    id: "r1",
    pr_number: 1,
    item_description: "ปูน",
    quantity: 1,
    unit: "ถุง",
    status: "requested",
    priority: "normal",
    requested_at: "2026-06-02",
    requested_by: "u1",
    requested_by_email: null,
    needed_by: null,
    decided_at: null,
    purchased_at: null,
    shipped_at: null,
    delivered_at: null,
    eta: null,
  },
];
// Spec 363 U4 — the WP's requests, in the two shapes production actually holds.
// ADR 0065 / spec 208 U4a: every purchase is store-bound, so the server FORCES
// `work_package_id: null` and records the WP in `requested_from_work_package_id`.
// Live 2026-07-27: work_package_id = 4 rows (all cancelled, last written 07-08);
// requested_from_work_package_id = 170 rows across 67 WPs, last written today.
// A reader keyed on work_package_id alone therefore renders EMPTY for every WP.
const REQ_PROVENANCE = {
  ...REQUESTS[0]!,
  id: "r-prov",
  project_id: "proj1",
  work_package_id: null,
  requested_from_work_package_id: "wp1",
};
const REQ_LEGACY = {
  ...REQUESTS[0]!,
  id: "r-legacy",
  project_id: "proj1",
  work_package_id: "wp1",
  requested_from_work_package_id: null,
};
const REQ_OTHER_WP = {
  ...REQUESTS[0]!,
  id: "r-other",
  project_id: "proj1",
  work_package_id: null,
  requested_from_work_package_id: "wpOTHER",
};
// The provenance column is CALLER-SUPPLIED and ungated: the INSERT WITH CHECK
// (`purchase_requests insert by wp-readers`, read live 2026-07-27) constrains
// `project_id` and `work_package_id` but never mentions
// `requested_from_work_package_id`, and the validator only shape-checks it as a
// uuid. So a request belonging to another PROJECT can point its provenance at
// this WP. 0 such rows exist today — but that is data, not a constraint, so the
// reader must scope by project rather than trust the FK.
const REQ_FOREIGN_PROJECT = {
  ...REQUESTS[0]!,
  id: "r-foreign",
  project_id: "projOTHER",
  work_package_id: null,
  requested_from_work_package_id: "wp1",
};

const SIBLINGS = [{ id: "wp2", code: "WP-02", name: "งานคาน" }];
const DEPS = [{ predecessor_id: "wp2" }];

const SINGLE: Record<string, unknown> = { work_packages: WP_ROW };
const LIST: Record<string, unknown[]> = {
  work_packages: SIBLINGS, // the siblings query (list form)
  contractors: CONTRACTORS,
  approvals: APPROVALS,
  work_package_dependencies: DEPS,
};

// Spec 337 U2a — audit_log is read TWICE (rework reasons + resubmits) and the
// two must not be interchangeable, so the stub honours the `payload->>event`
// filter. Without this the resubmit assertion below would stay green even if the
// production read filtered on the wrong event, the wrong target, or nothing.
const AUDIT_BY_EVENT: Record<string, unknown[]> = {
  wp_evidence_resubmitted: [
    { payload: { event: "wp_evidence_resubmitted", answers_decision_id: "a1" } },
  ],
  wp_reopened_for_defect: [],
};

// Spec 363 U4 — the purchase_requests stub HONOURS the filter, so a reader keyed
// on the wrong column returns nothing instead of silently passing. Emulates
// PostgREST: `.eq(col,val)` are ANDed; `.or("a.eq.x,b.eq.y")` is one ORed group.
const ALL_REQUESTS = [REQ_PROVENANCE, REQ_LEGACY, REQ_OTHER_WP, REQ_FOREIGN_PROJECT];
// Production selects NEITHER linkage column (see load-detail.ts RequestRow), so
// the stub strips them from what it RETURNS while still filtering on them — a
// consumer reading r.work_package_id must not pass green here and be undefined live.
const LINKAGE = ["project_id", "work_package_id", "requested_from_work_package_id"] as const;
function stripLinkage(row: Record<string, unknown>) {
  const out = { ...row };
  for (const k of LINKAGE) delete out[k];
  return out;
}
// 🟡 PostgREST would 400 on a malformed or-group; the semantic matcher alone would
// stay green. Pin the emitted SYNTAX too.
const OR_SHAPE = /^[a-z_]+.eq.[A-Za-z0-9-]+,[a-z_]+.eq.[A-Za-z0-9-]+$/;
let lastOrExpr: string | null = null;

function matchesRequestFilter(
  row: Record<string, unknown>,
  eqs: [string, unknown][],
  orExpr: string | null,
): boolean {
  for (const [col, val] of eqs) if (row[col] !== val) return false;
  if (orExpr === null) return true;
  return orExpr.split(",").some((term) => {
    const [col, op, val] = term.split(".");
    return op === "eq" && row[String(col)] === val;
  });
}

function makeQuery(table: string) {
  const q: Record<string, unknown> = {
    __single: false,
    __event: null as string | null,
    __or: null as string | null,
    __eqs: [] as [string, unknown][],
  };
  for (const m of ["select", "neq", "in", "order", "limit"]) {
    q[m] = () => q;
  }
  q.or = (expr: string) => {
    q.__or = expr;
    if (table === "purchase_requests") lastOrExpr = expr;
    return q;
  };
  // Capture the event filter so audit_log reads are told apart (see AUDIT_BY_EVENT).
  q.eq = (col: string, val: unknown) => {
    if (col === "payload->>event") q.__event = String(val);
    else (q.__eqs as [string, unknown][]).push([col, val]);
    return q;
  };
  q.maybeSingle = () => {
    q.__single = true;
    return q;
  };
  // thenable: subscribing (await / Promise.all) marks the query in-flight
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise((r) => setTimeout(r, 5))
      .then(() => {
        inFlight--;
        const data = q.__single
          ? SINGLE[table]
          : table === "audit_log"
            ? (AUDIT_BY_EVENT[String(q.__event)] ?? [])
            : table === "purchase_requests"
              ? ALL_REQUESTS.filter((r) =>
                  matchesRequestFilter(
                    r as unknown as Record<string, unknown>,
                    q.__eqs as [string, unknown][],
                    q.__or as string | null,
                  ),
                ).map((r) => stripLinkage(r as unknown as Record<string, unknown>))
              : (LIST[table] ?? []);
        return { data, error: null };
      })
      .then(resolve, reject);
  };
  return q;
}

// Spec 352 — the loader also calls the can_recall_work_package RPC in the fan.
// The stub mirrors makeQuery's in-flight tracking so the RPC counts toward the
// concurrency floor, and returns a boolean like the real predicate.
const CAN_RECALL = true;
function makeRpc(data: unknown) {
  return {
    then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((r) => setTimeout(r, 5))
        .then(() => {
          inFlight--;
          return { data, error: null };
        })
        .then(resolve, reject);
    },
  };
}

const supabase = {
  from: (table: string) => makeQuery(table),
  rpc: (fn: string) => makeRpc(fn === "can_recall_work_package" ? CAN_RECALL : null),
} as never;

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
});

describe("loadWorkPackageDetail", () => {
  it("runs the independent fan concurrently (not a serial waterfall)", async () => {
    await loadWorkPackageDetail(supabase, {
      workPackageId: "wp1",
      projectId: "proj1",
      isPlanner: true,
    });
    // contractors + approvals + purchase_requests + siblings + deps + the two
    // audit_log reads (rework reasons, spec 337 resubmits) + the spec 352
    // can_recall_work_package RPC = 8 reads that depend only on the root → must
    // overlap. Serial would peak at 1.
    //
    // The floor tracks the ACTUAL fan width rather than staying loose: a loose
    // floor cannot notice a new read being appended as a serial waterfall step,
    // which is exactly the regression this test exists to catch. Adding a fan
    // read? Raise this. Removing one? Lower it deliberately.
    expect(maxInFlight).toBeGreaterThanOrEqual(8);
  });

  it("assembles the correct shape", async () => {
    const data = await loadWorkPackageDetail(supabase, {
      workPackageId: "wp1",
      projectId: "proj1",
      isPlanner: true,
    });
    expect(data.wp).toEqual(WP_ROW);
    expect(data.contractors).toEqual(CONTRACTORS);
    expect(data.approvals).toEqual(APPROVALS);
    // Spec 363 U4 — deliberately updated, not "made green": the stub now honours
    // the request filter, so this WP sees BOTH linkage shapes (the live provenance
    // row and the legacy work_package_id row) and neither wpOTHER's nor another
    // project's. Asserted on ids because production selects no linkage column.
    expect(data.wpRequests.map((r) => r.id)).toEqual(["r-prov", "r-legacy"]);
    expect(data.siblingWps).toEqual(SIBLINGS);
    expect(data.predecessorIds).toEqual(["wp2"]);
    expect(data.defectReason).toBeNull();
    // Spec 337 U2a — the resubmit audit rows reduce to the set of answered
    // decision ids the ส่งตรวจอีกครั้ง rule consumes.
    expect(data.answeredDecisionIds).toEqual(new Set(["a1"]));
    // Spec 352 — the can_recall_work_package RPC result flows through to the page.
    expect(data.canRecall).toBe(true);
    expect(data.displayNames.get("u1")).toBe("ชื่อ");
    // spec 289 U2: the zone's projectWorkers passes through untouched
    expect(data.labor.projectWorkers).toEqual([{ id: "w1", name: "สมชาย" }]);
  });

  it("returns wp=null when the row is missing or the project mismatches", async () => {
    const other = await loadWorkPackageDetail(supabase, {
      workPackageId: "wp1",
      projectId: "WRONG",
      isPlanner: false,
    });
    expect(other.wp).toBeNull();
  });

  // Spec 289 U1: photo-uploader names resolve in the SAME tail read as the
  // approval/request actor names — one users query, not a second serial one
  // on the page.
  it("resolves photo-uploader ids in the single display-names tail read", async () => {
    const photo = (id: string, uploaded_by: string) =>
      ({ id, uploaded_by, captured_at_client: null, created_at: "2026-07-10" }) as never;
    vi.mocked(getPhotoViewForWorkPackage).mockResolvedValueOnce({
      current: {
        before: [photo("p1", "u9")],
        during: [],
        after: [],
        after_fix: [],
        defect: [photo("p2", "u10")],
      },
      // Spec 341 U1 — a REMOVER need not be among the uploaders still on the WP,
      // so their id has to reach the same single names read or the trace renders
      // "ไม่ทราบชื่อ" for somebody the app can name.
      removed: {
        ...EMPTY_BY_PHASE,
        during: [{ id: "p3", seq: 2, removedBy: "u11", removedAt: "2026-07-22" }],
      },
    });
    vi.mocked(fetchDisplayNames).mockClear();
    await loadWorkPackageDetail(supabase, {
      workPackageId: "wp1",
      projectId: "proj1",
      isPlanner: true,
    });
    expect(vi.mocked(fetchDisplayNames)).toHaveBeenCalledTimes(1);
    const ids = vi.mocked(fetchDisplayNames).mock.calls[0]![0];
    // actor id from approvals/requests AND both uploader ids (incl. defect phase)
    expect(ids).toEqual(expect.arrayContaining(["u1", "u9", "u10", "u11"]));
  });

  it("skips planner queries when isPlanner is false", async () => {
    const data = await loadWorkPackageDetail(supabase, {
      workPackageId: "wp1",
      projectId: "proj1",
      isPlanner: false,
    });
    expect(data.siblingWps).toEqual([]);
    expect(data.predecessorIds).toEqual([]);
  });
});

// Spec 363 U4 — the WP's purchase requests must be found by PROVENANCE, not by
// work_package_id. ADR 0065 / spec 208 U4a forces work_package_id to null on
// every purchase (all stock is store-bound), so the original reader matched
// nothing: live 2026-07-27, work_package_id held 4 rows (all cancelled, last
// written 07-08) while requested_from_work_package_id held 170 across 67 WPs,
// last written that day. An SA raised a request from the WP page and it never
// appeared on the WP page.
describe("loadWorkPackageDetail — the WP's purchase requests (spec 363 U4)", () => {
  async function load() {
    return loadWorkPackageDetail(supabase, {
      workPackageId: "wp1",
      projectId: "proj1",
      isPlanner: false,
    });
  }

  it("finds requests linked by requested_from_work_package_id", async () => {
    const out = await load();
    expect(out.wpRequests.map((r) => r.id)).toContain("r-prov");
  });

  it("still finds the legacy rows written directly to work_package_id", async () => {
    const out = await load();
    expect(out.wpRequests.map((r) => r.id)).toContain("r-legacy");
  });

  it("does not leak another work package's requests", async () => {
    const out = await load();
    expect(out.wpRequests.map((r) => r.id)).not.toContain("r-other");
  });

  it("does not show a request that belongs to another project", async () => {
    // Provenance is caller-supplied and the INSERT WITH CHECK never constrains
    // it, so the FK alone is not proof the row belongs here. Scope by project.
    const out = await load();
    expect(out.wpRequests.map((r) => r.id)).not.toContain("r-foreign");
  });
});

describe("loadWorkPackageDetail — the request filter is well-formed (spec 363 U4)", () => {
  it("emits an or-group PostgREST can parse", async () => {
    await loadWorkPackageDetail(supabase, {
      workPackageId: "wp1",
      projectId: "proj1",
      isPlanner: false,
    });
    // A semantic-only stub would stay green on a filter that 400s in production.
    expect(lastOrExpr).not.toBeNull();
    expect(lastOrExpr).toMatch(OR_SHAPE);
  });
});
