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
const SIBLINGS = [{ id: "wp2", code: "WP-02", name: "งานคาน" }];
const DEPS = [{ predecessor_id: "wp2" }];

const SINGLE: Record<string, unknown> = { work_packages: WP_ROW };
const LIST: Record<string, unknown[]> = {
  work_packages: SIBLINGS, // the siblings query (list form)
  contractors: CONTRACTORS,
  approvals: APPROVALS,
  purchase_requests: REQUESTS,
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

function makeQuery(table: string) {
  const q: Record<string, unknown> = { __single: false, __event: null as string | null };
  for (const m of ["select", "neq", "in", "order", "limit"]) {
    q[m] = () => q;
  }
  // Capture the event filter so audit_log reads are told apart (see AUDIT_BY_EVENT).
  q.eq = (col: string, val: unknown) => {
    if (col === "payload->>event") q.__event = String(val);
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
            : (LIST[table] ?? []);
        return { data, error: null };
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

describe("loadWorkPackageDetail", () => {
  it("runs the independent fan concurrently (not a serial waterfall)", async () => {
    await loadWorkPackageDetail(supabase, {
      workPackageId: "wp1",
      projectId: "proj1",
      isPlanner: true,
    });
    // contractors + approvals + purchase_requests + siblings + deps + the two
    // audit_log reads (rework reasons, spec 337 resubmits) = 7 queries that
    // depend only on the root → must overlap. Serial would peak at 1.
    //
    // The floor tracks the ACTUAL fan width rather than staying at the original
    // 5: a loose floor cannot notice a new read being appended as a serial
    // waterfall step, which is exactly the regression this test exists to catch.
    // Adding a fan read? Raise this. Removing one? Lower it deliberately.
    expect(maxInFlight).toBeGreaterThanOrEqual(7);
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
    expect(data.wpRequests).toEqual(REQUESTS);
    expect(data.siblingWps).toEqual(SIBLINGS);
    expect(data.predecessorIds).toEqual(["wp2"]);
    expect(data.defectReason).toBeNull();
    // Spec 337 U2a — the resubmit audit rows reduce to the set of answered
    // decision ids the ส่งตรวจอีกครั้ง rule consumes.
    expect(data.answeredDecisionIds).toEqual(new Set(["a1"]));
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
