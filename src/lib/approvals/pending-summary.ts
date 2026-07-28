// Spec 183 U1 — pending-approval awareness for the ภาพรวม hero card.
//
// The work-package approval queue (status = 'pending_approval') reframed
// from a top-level PM tab into a count + oldest-waiting summary. The async
// fetch mirrors the /review queue query exactly (all pending WPs, RLS-scoped
// to the caller) so the dashboard count never disagrees with the list it
// links to. The reduce is a pure function so it's unit-testable without a
// Supabase mock — same shape as latest-decision.ts.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

/**
 * Spec 371 U2 — the zones of `public.work_package_review_queue`, which is the
 * SSOT for "whose move is this pending work package". Kept as a union rather
 * than the view's raw `string` so a typo cannot silently become a fourth zone
 * that no branch handles.
 */
export type ReviewZone = "first_review" | "ready_again" | "awaiting_site";

/** Zones the PM can act on right now — everything except awaiting_site. */
export function isActionableZone(zone: ReviewZone): boolean {
  return zone !== "awaiting_site";
}

export interface PendingWp {
  id: string;
  code: string;
  project_id: string;
  updated_at: string;
  /** Spec 371 U2 — the zone from work_package_review_queue. `awaiting_site` is
   *  waiting on the site admin, so it is NOT part of the count the PM is shown. */
  zone: ReviewZone;
}

export interface PendingApprovalsSummary {
  /** ACTIONABLE only — first_review + ready_again. */
  count: number;
  /** Spec 371 U2: shown BESIDE the count, not folded into it (operator: "how
   *  about separating them?"). */
  awaitingSite: number;
  oldest: {
    workPackageId: string;
    wpCode: string;
    projectCode: string | null;
    projectName: string | null;
    waitingSince: string;
  } | null;
}

// Pure: pending WPs (any order) + a project lookup → the hero-card view model.
// Oldest = min updated_at (the status flip to pending_approval is the last app
// write, so updated_at marks queue entry — spec 15 C), code as the
// deterministic tiebreak. Mirrors the /review ordering.
export function summarizePendingApprovals(
  rows: ReadonlyArray<PendingWp>,
  projectsById: ReadonlyMap<string, { code: string; name: string }>,
): PendingApprovalsSummary {
  // Spec 371 U2: split BEFORE counting. An un-cured bounce is the site admin's
  // move — folding it into the PM's number is what made 70 misleading, and
  // letting one be "oldest" would point เก่าสุด at a WP the PM cannot act on.
  const actionable = rows.filter((r) => isActionableZone(r.zone));
  const awaitingSite = rows.length - actionable.length;
  if (actionable.length === 0) return { count: 0, awaitingSite, oldest: null };
  let oldest = actionable[0]!;
  for (const r of actionable) {
    const earlier =
      r.updated_at < oldest.updated_at ||
      (r.updated_at === oldest.updated_at && r.code < oldest.code);
    if (earlier) oldest = r;
  }
  const project = projectsById.get(oldest.project_id);
  return {
    count: actionable.length,
    awaitingSite,
    oldest: {
      workPackageId: oldest.id,
      wpCode: oldest.code,
      projectCode: project?.code ?? null,
      projectName: project?.name ?? null,
      waitingSince: oldest.updated_at,
    },
  };
}

// Async fetch — RLS-scoped, user session. Mirrors the /review queue query so
// the count and the list agree. Two simple queries (pending WPs, then their
// projects), matching the /review page pattern.
export async function getPendingApprovalsSummary(
  supabase: SupabaseClient<Database>,
): Promise<PendingApprovalsSummary> {
  // Spec 371 U2: read the VIEW, not work_packages. The zone predicate ("is the
  // latest decision an unanswered needs_revision?") is a top-1-per-group join
  // plus an audit_log existence check — it lives in
  // public.work_package_review_queue so this hero, the nav badge and /review all
  // derive their numbers from one definition. Still RLS-scoped: the view is
  // security_invoker, so each viewer sees exactly their own projects.
  const { data: queueRows, error } = await supabase
    .from("work_package_review_queue")
    .select("id, code, project_id, updated_at, zone");
  if (error) throw error;
  // The view's columns are nullable in the generated types (PostgREST cannot
  // infer NOT NULL through a view); every row is a real work_packages row, so
  // drop any that somehow lack the fields rather than rendering blanks.
  const rows: PendingWp[] = (queueRows ?? []).flatMap((r) =>
    r.id && r.code && r.project_id && r.updated_at && r.zone
      ? [
          {
            id: r.id,
            code: r.code,
            project_id: r.project_id,
            updated_at: r.updated_at,
            zone: r.zone as ReviewZone,
          },
        ]
      : [],
  );
  if (rows.length === 0) return summarizePendingApprovals(rows, new Map());

  const projectIds = Array.from(new Set(rows.map((w) => w.project_id)));
  const { data: projects } = await supabase
    .from("projects")
    .select("id, code, name")
    .in("id", projectIds);
  const projectsById = new Map((projects ?? []).map((p) => [p.id, { code: p.code, name: p.name }]));
  return summarizePendingApprovals(rows, projectsById);
}
