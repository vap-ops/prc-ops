// Spec 147 U1 — WP-detail data loader. The page formerly ran ~10 Supabase reads
// in a serial waterfall; the child reads depend only on the work package, not on
// each other, so they batch into one Promise.all (root → fan → dependent tail).
// Behavior-preserving: same queries, same column lists, same results — only the
// scheduling changes. Mirrors fetchLaborZoneData (spec 46). Concurrency is locked
// by tests/unit/load-work-package-detail.test.ts.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { fetchLaborZoneData } from "@/lib/labor/fetch-zone-data";
import { groupRoster, type GroupedRoster } from "@/lib/labor/group-workers";
import type { LaborDisplayRow } from "@/lib/labor/types";
import {
  getPhotoViewForWorkPackage,
  type RemovedPhotosByPhase,
  type PhotoLogRow,
  type CurrentPhotosByPhase,
} from "@/lib/photos/current-photos";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { reworkReasonsFromAuditRows, reworkSourcesFromAuditRows } from "@/lib/photos/rework-round";
import type { ReworkSource } from "@/lib/db/enums";
import { fetchDisplayNames } from "@/lib/users/display-names";

type Tbl = Database["public"]["Tables"];
type WpRow = Pick<
  Tbl["work_packages"]["Row"],
  | "id"
  | "code"
  | "name"
  | "status"
  | "project_id"
  | "description"
  | "contractor_id"
  | "notes"
  | "priority"
  | "planned_start"
  | "planned_end"
  // Spec 155: the WP-detail deliverable control reads the current binding.
  | "deliverable_id"
  // Spec 226 / 207 U3c: the WP-detail work-category control reads the current binding.
  | "category_id"
  // Spec 216: the current rework cycle — the หลังแก้ไข tile captures into it.
  | "rework_round"
>;
type ContractorRow = Pick<
  Tbl["contractors"]["Row"],
  "id" | "name" | "phone" | "status" | "contractor_category"
>;
type ApprovalRow = Pick<
  Tbl["approvals"]["Row"],
  "id" | "decision" | "comment" | "decided_by" | "decided_at"
>;
type SiblingRow = Pick<Tbl["work_packages"]["Row"], "id" | "code" | "name">;
type RequestRow = Pick<
  Tbl["purchase_requests"]["Row"],
  | "id"
  | "pr_number"
  | "item_description"
  | "quantity"
  | "unit"
  | "status"
  | "priority"
  | "requested_at"
  | "requested_by"
  | "requested_by_email"
  | "needed_by"
  | "decided_at"
  | "purchased_at"
  | "shipped_at"
  | "delivered_at"
  | "eta"
>;

export interface WorkPackageDetailData {
  wp: WpRow | null;
  contractors: ContractorRow[];
  approvals: ApprovalRow[];
  wpRequests: RequestRow[];
  siblingWps: SiblingRow[];
  predecessorIds: string[];
  labor: {
    roster: GroupedRoster;
    projectWorkerIds: string[];
    projectWorkers: { id: string; name: string }[];
    rows: LaborDisplayRow[];
  };
  photosByPhase: CurrentPhotosByPhase;
  /** Spec 341 U1 — the removal trace: which number went, who took it, when. */
  removedByPhase: RemovedPhotosByPhase;
  signedUrls: Map<string, string>;
  displayNames: Map<string, string>;
  defectReason: string | null;
  /** Spec 216: rework round → the defect reason that opened it, for the per-round
   *  หลังแก้ไข gallery sections. */
  reworkReasons: Map<number, string>;
  /** Spec 217: rework round → its source (internal/client). */
  reworkSources: Map<number, ReworkSource>;
  /** Spec 217: the current (latest) rework's source — for the rework banner; null
   *  when not in rework or a legacy reopen carried no source. */
  defectSource: ReworkSource | null;
  /** Spec 337 U2a: `answers_decision_id` of every resubmit already recorded on
   *  this WP — the cure loop is closed for those bounces. */
  answeredDecisionIds: Set<string>;
  /** Spec 352: may THIS viewer recall the submission (pending_approval + window
   *  closed + they are the submitter or super_admin)? The can_recall_work_package
   *  DEFINER predicate is the authority — the RPC enforces from the same one. */
  canRecall: boolean;
}

type Db = SupabaseClient<Database>;

export async function loadWorkPackageDetail(
  supabase: Db,
  args: { workPackageId: string; projectId: string; isPlanner: boolean },
): Promise<WorkPackageDetailData> {
  const { workPackageId, projectId, isPlanner } = args;

  const { data: wp } = await supabase
    .from("work_packages")
    .select(
      "id, code, name, status, project_id, description, contractor_id, notes, priority, planned_start, planned_end, deliverable_id, category_id, rework_round",
    )
    .eq("id", workPackageId)
    .maybeSingle();

  if (!wp || wp.project_id !== projectId) {
    return {
      wp: null,
      contractors: [],
      approvals: [],
      wpRequests: [],
      siblingWps: [],
      predecessorIds: [],
      labor: { roster: groupRoster([], []), projectWorkerIds: [], projectWorkers: [], rows: [] },
      photosByPhase: { before: [], during: [], after: [], after_fix: [], defect: [] },
      removedByPhase: { before: [], during: [], after: [], after_fix: [], defect: [] },
      signedUrls: new Map(),
      displayNames: new Map(),
      defectReason: null,
      reworkReasons: new Map(),
      reworkSources: new Map(),
      defectSource: null,
      answeredDecisionIds: new Set<string>(),
      canRecall: false,
    };
  }

  // The fan: every read here depends only on the work package, never on a
  // sibling read — so they run together instead of in series.
  // Spec 289 U2: ONE contractors read serves both this loader's superset rows
  // and the labor zone's roster grouping (was a duplicate id+name read).
  const contractorsShared = supabase
    .from("contractors")
    .select("id, name, phone, status, contractor_category")
    .order("name", { ascending: true })
    .then((r) => r.data ?? []);
  const [
    contractorRows,
    { data: approvalRows },
    { data: requestRows },
    planner,
    labor,
    photoView,
    reworkData,
    { data: resubmitRows },
    { data: canRecallData },
  ] = await Promise.all([
    contractorsShared,
    supabase
      .from("approvals")
      .select("id, decision, comment, decided_by, decided_at")
      .eq("work_package_id", wp.id)
      // The id tiebreak matches selectLatestDecisionByWorkPackage,
      // resubmit_work_package_evidence and photo_removal_allowed, so
      // `approvals[0]` is the same row every one of them calls current.
      .order("decided_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase
      .from("purchase_requests")
      .select(
        "id, pr_number, item_description, quantity, unit, status, priority, requested_at, requested_by, requested_by_email, needed_by, decided_at, purchased_at, shipped_at, delivered_at, eta",
      )
      .eq("work_package_id", wp.id)
      .order("requested_at", { ascending: false }),
    loadPlanner(supabase, wp.id, wp.project_id, isPlanner),
    fetchLaborZoneData(supabase, wp.id, wp.project_id, contractorsShared),
    getPhotoViewForWorkPackage(supabase, wp.id),
    loadReworkData(supabase, wp.id, wp.status),
    // Spec 337 U2a — which needs_revision bounces the SA has already answered.
    // Readable by site_admin because …075828 named this event in their audit_log
    // allowlist (that policy is an allowlist, NOT `using(true)`).
    supabase
      .from("audit_log")
      .select("payload")
      // target_table first — audit_log_target_idx is (target_table, target_id).
      .eq("target_table", "work_packages")
      .eq("target_id", wp.id)
      .eq("payload->>event", "wp_evidence_resubmitted"),
    // Spec 352 — may THIS viewer recall the submission? The can_recall_work_package
    // DEFINER predicate does the privileged reads (the submitter from audit_log,
    // whose SELECT this user session cannot see); load-detail calls it, the recall
    // RPC enforces from the same one, so the button and the gate never drift.
    supabase.rpc("can_recall_work_package", { p_wp: wp.id }),
  ]);

  const approvals = approvalRows ?? [];
  const wpRequests = requestRows ?? [];
  const answeredDecisionIds = new Set(
    (resubmitRows ?? [])
      .map((r) => (r.payload as { answers_decision_id?: string } | null)?.answers_decision_id)
      .filter((id): id is string => typeof id === "string"),
  );

  // Dependent tail: display names need the ids from approvals+requests+photo
  // uploaders (spec 289 U1 — one users read serves the lightbox uploader line
  // too, replacing the page's second serial fetchDisplayNames); signed URLs
  // need the photo rows. Both batch.
  const photosByPhase = photoView.current;
  const removedByPhase = photoView.removed;
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
    ...photosByPhase.after_fix,
    // Spec 248 — defect photos render in the banner/gallery/pair slots; a
    // phase missing here ships broken (un-signed) images.
    ...photosByPhase.defect,
  ];
  const nameIds = Array.from(
    new Set(
      [
        ...approvals.map((a) => a.decided_by),
        ...wpRequests.map((r) => r.requested_by),
        ...allPhotos.map((p) => p.uploaded_by),
        // Spec 341 U1 — whoever REMOVED a photo is named in the trace too, and
        // they need not be among the uploaders still on the WP.
        ...Object.values(removedByPhase).flatMap((entries) => entries.map((e) => e.removedBy)),
      ].filter((id): id is string => typeof id === "string"),
    ),
  );
  const [displayNames, signedUrls] = await Promise.all([
    fetchDisplayNames(nameIds, "[wp-detail]"),
    mintSignedUrlsForPhotos(allPhotos),
  ]);

  return {
    wp,
    contractors: contractorRows,
    approvals,
    wpRequests,
    siblingWps: planner.siblingWps,
    predecessorIds: planner.predecessorIds,
    labor,
    photosByPhase,
    removedByPhase,
    signedUrls,
    displayNames,
    defectReason: reworkData.defectReason,
    reworkReasons: reworkData.reworkReasons,
    reworkSources: reworkData.reworkSources,
    defectSource: reworkData.defectSource,
    answeredDecisionIds,
    canRecall: canRecallData ?? false,
  };
}

// Spec 92: schedule + dependency editing is PM/super only. The two reads batch.
async function loadPlanner(
  supabase: Db,
  wpId: string,
  projectId: string,
  isPlanner: boolean,
): Promise<{ siblingWps: SiblingRow[]; predecessorIds: string[] }> {
  if (!isPlanner) return { siblingWps: [], predecessorIds: [] };
  const [{ data: siblings }, { data: depRows }] = await Promise.all([
    supabase
      .from("work_packages")
      .select("id, code, name")
      .eq("project_id", projectId)
      .neq("id", wpId)
      .order("code", { ascending: true }),
    supabase.from("work_package_dependencies").select("predecessor_id").eq("successor_id", wpId),
  ]);
  return {
    siblingWps: siblings ?? [],
    predecessorIds: (depRows ?? []).map((d) => d.predecessor_id),
  };
}

// Spec 144/216: a WP reopened for a defect records one wp_reopened_for_defect
// audit_log row per round (newest first) — spec 337 F3 adds a second writer, a
// review rejection, which records the PM's comment in the same shape (payload
// `via: 'review_rejection'`). One read serves both the rework banner (the latest
// reason, only while in rework) and the per-round หลังแก้ไข gallery reasons
// (round → reason, every round). NOTE: audit_log SELECT is NOT `using(true)` —
// the site_admin/procurement policy is an EVENT ALLOWLIST, and this event is on
// it (verified live 2026-07-22); a new audit event is invisible to those roles
// until the policy names it.
async function loadReworkData(
  supabase: Db,
  wpId: string,
  status: WpRow["status"],
): Promise<{
  defectReason: string | null;
  reworkReasons: Map<number, string>;
  reworkSources: Map<number, ReworkSource>;
  defectSource: ReworkSource | null;
}> {
  const { data: rows } = await supabase
    .from("audit_log")
    .select("payload")
    .eq("target_id", wpId)
    .eq("payload->>event", "wp_reopened_for_defect")
    .order("created_at", { ascending: false });
  const reopenRows = rows ?? [];
  // Rows are newest-first; the first is the current/most-recent reopen.
  const latest = reopenRows[0]?.payload as unknown as {
    reason?: string;
    source?: ReworkSource;
  } | null;
  const latestSource =
    latest?.source === "client" || latest?.source === "internal" ? latest.source : null;
  return {
    defectReason: status === "rework" ? (latest?.reason ?? null) : null,
    reworkReasons: reworkReasonsFromAuditRows(reopenRows),
    reworkSources: reworkSourcesFromAuditRows(reopenRows),
    defectSource: status === "rework" ? latestSource : null,
  };
}
