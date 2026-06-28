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
  getCurrentPhotosForWorkPackage,
  type PhotoLogRow,
  type CurrentPhotosByPhase,
} from "@/lib/photos/current-photos";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { reworkReasonsFromAuditRows } from "@/lib/photos/rework-round";
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
  // Spec 216: the current rework cycle — the หลังแก้ไข tile captures into it.
  | "rework_round"
>;
type ContractorRow = Pick<Tbl["contractors"]["Row"], "id" | "name" | "phone" | "status">;
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
  labor: { roster: GroupedRoster; projectWorkerIds: string[]; rows: LaborDisplayRow[] };
  photosByPhase: CurrentPhotosByPhase;
  signedUrls: Map<string, string>;
  displayNames: Map<string, string>;
  defectReason: string | null;
  /** Spec 216: rework round → the defect reason that opened it, for the per-round
   *  หลังแก้ไข gallery sections. */
  reworkReasons: Map<number, string>;
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
      "id, code, name, status, project_id, description, contractor_id, notes, priority, planned_start, planned_end, deliverable_id, rework_round",
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
      labor: { roster: groupRoster([], []), projectWorkerIds: [], rows: [] },
      photosByPhase: { before: [], during: [], after: [], after_fix: [] },
      signedUrls: new Map(),
      displayNames: new Map(),
      defectReason: null,
      reworkReasons: new Map(),
    };
  }

  // The fan: every read here depends only on the work package, never on a
  // sibling read — so they run together instead of in series.
  const [
    { data: contractorRows },
    { data: approvalRows },
    { data: requestRows },
    planner,
    labor,
    photosByPhase,
    reworkData,
  ] = await Promise.all([
    supabase
      .from("contractors")
      .select("id, name, phone, status")
      .order("name", { ascending: true }),
    supabase
      .from("approvals")
      .select("id, decision, comment, decided_by, decided_at")
      .eq("work_package_id", wp.id)
      .order("decided_at", { ascending: false }),
    supabase
      .from("purchase_requests")
      .select(
        "id, pr_number, item_description, quantity, unit, status, priority, requested_at, requested_by, requested_by_email, needed_by, decided_at, purchased_at, shipped_at, delivered_at, eta",
      )
      .eq("work_package_id", wp.id)
      .order("requested_at", { ascending: false }),
    loadPlanner(supabase, wp.id, wp.project_id, isPlanner),
    fetchLaborZoneData(supabase, wp.id, wp.project_id),
    getCurrentPhotosForWorkPackage(supabase, wp.id),
    loadReworkData(supabase, wp.id, wp.status),
  ]);

  const approvals = approvalRows ?? [];
  const wpRequests = requestRows ?? [];

  // Dependent tail: display names need the ids from approvals+requests; signed
  // URLs need the photo rows. Both batch.
  const nameIds = Array.from(
    new Set(
      [...approvals.map((a) => a.decided_by), ...wpRequests.map((r) => r.requested_by)].filter(
        (id): id is string => typeof id === "string",
      ),
    ),
  );
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
    ...photosByPhase.after_fix,
  ];
  const [displayNames, signedUrls] = await Promise.all([
    fetchDisplayNames(nameIds, "[wp-detail]"),
    mintSignedUrlsForPhotos(allPhotos),
  ]);

  return {
    wp,
    contractors: contractorRows ?? [],
    approvals,
    wpRequests,
    siblingWps: planner.siblingWps,
    predecessorIds: planner.predecessorIds,
    labor,
    photosByPhase,
    signedUrls,
    displayNames,
    defectReason: reworkData.defectReason,
    reworkReasons: reworkData.reworkReasons,
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
// audit_log row per round (newest first). One read serves both the rework banner
// (the latest reason, only while in rework) and the per-round หลังแก้ไข gallery
// reasons (round → reason, every round). audit_log SELECT is using(true).
async function loadReworkData(
  supabase: Db,
  wpId: string,
  status: WpRow["status"],
): Promise<{ defectReason: string | null; reworkReasons: Map<number, string> }> {
  const { data: rows } = await supabase
    .from("audit_log")
    .select("payload")
    .eq("target_id", wpId)
    .eq("payload->>event", "wp_reopened_for_defect")
    .order("created_at", { ascending: false });
  const reopenRows = rows ?? [];
  // Rows are newest-first; the first is the current/most-recent reopen.
  const latestReason =
    (reopenRows[0]?.payload as unknown as { reason?: string } | null)?.reason ?? null;
  return {
    defectReason: status === "rework" ? latestReason : null,
    reworkReasons: reworkReasonsFromAuditRows(reopenRows),
  };
}
