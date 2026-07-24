// "Latest decision per WP" read pattern.
//
// approvals is an append-only event log; the *current* decision for a
// WP is the row with max(decided_at) for that work_package_id. The
// composite index `approvals_work_package_id_decided_at_idx` makes the
// per-WP top-1 read cheap at the DB.
//
// PostgREST doesn't natively express "top-1 per group". At pilot
// scale (few WPs at pending_approval × small number of decisions per
// WP) the cheap approach is to fetch every approvals row for the WP
// set we care about and reduce in JS — same shape as
// current-photos.ts. The reduce is a pure function so it's
// unit-testable without a Supabase mock.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/db/database.types";

export type ApprovalRow = Pick<
  Tables<"approvals">,
  "work_package_id" | "decision" | "comment" | "decided_by" | "decided_at"
> & {
  id?: string;
  /** Spec 355 — optional so narrower approvals reads (e.g. the photo-removal
   *  window) keep satisfying the reduce without fetching it. */
  revision_reason?: Tables<"approvals">["revision_reason"];
};

export function selectLatestDecisionByWorkPackage(
  rows: ReadonlyArray<ApprovalRow>,
): Map<string, ApprovalRow> {
  const latest = new Map<string, ApprovalRow>();
  for (const r of rows) {
    const current = latest.get(r.work_package_id);
    // The id tiebreak mirrors resubmit_work_package_evidence's
    // `order by decided_at desc, id desc`, so the UI and the DB can never
    // disagree about which decision is current when two share a decided_at.
    const newer =
      !current ||
      r.decided_at > current.decided_at ||
      (r.decided_at === current.decided_at && (r.id ?? "") > (current.id ?? ""));
    if (newer) {
      latest.set(r.work_package_id, r);
    }
  }
  return latest;
}

export async function getLatestDecisionsForWorkPackages(
  supabase: SupabaseClient<Database>,
  workPackageIds: ReadonlyArray<string>,
): Promise<Map<string, ApprovalRow>> {
  if (workPackageIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("approvals")
    // Spec 337 U2a: `id` joins a decision to the wp_evidence_resubmitted audit
    // row that answered it, which is how /sa clears a bounce the SA has cured.
    // Spec 355: `revision_reason` rides to the ต้องแก้ไข worklist chip.
    .select("id, work_package_id, decision, comment, decided_by, decided_at, revision_reason")
    .in("work_package_id", workPackageIds as string[]);
  if (error) throw error;
  return selectLatestDecisionByWorkPackage(data ?? []);
}

export type ApprovalHistoryRow = Pick<
  Tables<"approvals">,
  "id" | "decision" | "comment" | "decided_by" | "decided_at"
>;

// Full decision history for one WP, newest first. Used by the review
// screen. Lives here (not inlined on the page) so the read pattern sits
// next to its latest-decision sibling and stays unit-testable.
export async function getDecisionHistoryForWorkPackage(
  supabase: SupabaseClient<Database>,
  workPackageId: string,
): Promise<ApprovalHistoryRow[]> {
  const { data, error } = await supabase
    .from("approvals")
    .select("id, decision, comment, decided_by, decided_at")
    .eq("work_package_id", workPackageId)
    .order("decided_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
