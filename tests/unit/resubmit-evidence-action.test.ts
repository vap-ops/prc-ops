// Writing failing test first.
//
// Spec 337 U2a — the server side of ส่งตรวจอีกครั้ง. The control's disabled
// state is convenience; this action is the enforcement, and it refuses from the
// SAME pure rule the control renders from (resubmitState), so a crafted request
// cannot bypass what the button was hiding. The DB backstop
// (resubmit_work_package_evidence, spec 337 U1) re-checks every clause again and
// is idempotent per decision.
//
// The admin-client mock THROWS: a cure-loop write has a human actor and must
// never run on the service-role session (that is the whole point of U1).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, getCurrentPhotos, rpc, adminClient, from } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  getCurrentPhotos: vi.fn(),
  rpc: vi.fn(),
  adminClient: vi.fn(),
  from: vi.fn(),
}));

const WP = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const DECISION_ID = "d1d1d1d1-0000-4000-8000-000000000001";
const DECIDED_AT = "2026-07-20T10:00:00+00:00";
const PM = "pm000000-0000-4000-8000-00000000pm01";
const NEWER = "2026-07-20T11:00:00+00:00";
const OLDER = "2026-07-20T09:00:00+00:00";

vi.mock("@/lib/auth/action-gate", () => ({
  requireActionRole,
  getActionUser: vi.fn(),
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("@/lib/photos/current-photos", () => ({
  getCurrentPhotosForWorkPackage: getCurrentPhotos,
}));
vi.mock("@/lib/db/admin", () => ({ createClient: adminClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { resubmitWorkPackageEvidence } from "@/app/projects/[projectId]/work-packages/[workPackageId]/actions";
import { RESUBMIT_EVIDENCE_HINT, RESUBMIT_DONE_NOTE } from "@/lib/approvals/resubmit";
import { NOT_PENDING_REVIEW_ERROR } from "@/lib/approvals/predicates";

const noPhotos = { before: [], during: [], after: [], after_fix: [], defect: [] };

/** A supabase stub whose three reads (WP, latest decision, resubmit audit rows)
 *  are dispatched by table name — the action issues them in that order. */
function client(opts: {
  wp: { id: string; project_id: string; status: string } | null;
  decisions: Array<{ id: string; decision: string; decided_at: string; decided_by: string }>;
  answered: string[];
  /** The action re-reads the audit rows when the RPC raises 22023 — this is what
   *  that SECOND read sees (a concurrent resubmit landed in between). */
  answeredOnRecheck?: string[];
}) {
  let auditReads = 0;
  // Chain-shape-agnostic on purpose: the action's filter/order chains are an
  // implementation detail (adding an .order() or an .eq() must not break these
  // tests), so every builder method returns the same thenable and only the TABLE
  // decides the rows.
  from.mockImplementation((table: string) => {
    const rows = () => {
      if (table === "work_packages") return { data: opts.wp, error: null };
      if (table === "approvals") return { data: opts.decisions, error: null };
      auditReads += 1;
      const ids = auditReads === 1 ? opts.answered : (opts.answeredOnRecheck ?? opts.answered);
      return { data: ids.map((id) => ({ payload: { answers_decision_id: id } })), error: null };
    };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "neq"]) q[m] = () => q;
    q.maybeSingle = async () => rows();
    q.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
      Promise.resolve(rows()).then(res, rej);
    return q;
  });
  return { from, rpc };
}

function authWith(opts: Parameters<typeof client>[0]) {
  requireActionRole.mockResolvedValue({
    auth: { supabase: client(opts), user: { id: "sa1" } },
    role: "site_admin",
  });
}

const openBounce = {
  wp: { id: WP, project_id: PROJECT, status: "pending_approval" },
  decisions: [
    { id: DECISION_ID, decision: "needs_revision", decided_at: DECIDED_AT, decided_by: PM },
  ],
  answered: [] as string[],
};

beforeEach(() => {
  requireActionRole.mockReset();
  from.mockReset();
  getCurrentPhotos.mockReset().mockResolvedValue({ ...noPhotos, after: [{ created_at: NEWER }] });
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  adminClient.mockReset().mockImplementation(() => {
    throw new Error("the cure loop has a human actor — never the service-role client");
  });
});

describe("resubmitWorkPackageEvidence — gates", () => {
  it("refuses an unknown work package", async () => {
    authWith({ ...openBounce, wp: null });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ไม่พบรายการงาน" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a WP that is no longer in the review queue", async () => {
    authWith({ ...openBounce, wp: { id: WP, project_id: PROJECT, status: "complete" } });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: NOT_PENDING_REVIEW_ERROR });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when the latest decision was not a re-shoot request", async () => {
    authWith({
      ...openBounce,
      decisions: [
        { id: DECISION_ID, decision: "approved", decided_at: DECIDED_AT, decided_by: PM },
      ],
    });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: NOT_PENDING_REVIEW_ERROR });
    expect(rpc).not.toHaveBeenCalled();
  });

  // The gate the whole unit exists for: the SA must actually have re-shot.
  it("refuses when no current photo is newer than the decision", async () => {
    authWith(openBounce);
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after: [{ created_at: OLDER }] });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: RESUBMIT_EVIDENCE_HINT });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a second resubmit answering the same decision", async () => {
    authWith({ ...openBounce, answered: [DECISION_ID] });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: RESUBMIT_DONE_NOTE });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("resubmitWorkPackageEvidence — the happy path and the DB backstop", () => {
  it("calls the DEFINER RPC on the caller's own session", async () => {
    authWith(openBounce);
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("resubmit_work_package_evidence", { p_wp: WP });
  });

  it("never constructs the service-role client", async () => {
    authWith(openBounce);
    await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("maps the RPC's 22023 (a colleague decided while the sheet was open) to the stale message", async () => {
    authWith(openBounce);
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "not pending approval" },
    });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: NOT_PENDING_REVIEW_ERROR });
  });

  // A double-tap (phone + tablet, or a retry) races past the pre-check: the RPC
  // serialises on FOR UPDATE and refuses the second call as ALREADY ANSWERED —
  // which from the SA's point of view is success, not "not up for review". The
  // action re-reads to tell the two 22023 causes apart.
  it("tells the SA it is already answered when a concurrent resubmit won the race", async () => {
    authWith({ ...openBounce, answeredOnRecheck: [DECISION_ID] });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "this revision request was already answered" },
    });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: RESUBMIT_DONE_NOTE });
  });

  it("maps the RPC's 42501 to the RLS-shaped not-found message", async () => {
    authWith(openBounce);
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not a member" } });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ไม่พบรายการงาน" });
  });

  it("maps any other RPC failure to the retry message", async () => {
    authWith(openBounce);
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    const r = await resubmitWorkPackageEvidence({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ส่งตรวจอีกครั้งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  });
});
