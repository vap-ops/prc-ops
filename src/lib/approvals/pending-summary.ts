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

export interface PendingWp {
  id: string;
  code: string;
  project_id: string;
  updated_at: string;
}

export interface PendingApprovalsSummary {
  count: number;
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
  if (rows.length === 0) return { count: 0, oldest: null };
  let oldest = rows[0]!;
  for (const r of rows) {
    const earlier =
      r.updated_at < oldest.updated_at ||
      (r.updated_at === oldest.updated_at && r.code < oldest.code);
    if (earlier) oldest = r;
  }
  const project = projectsById.get(oldest.project_id);
  return {
    count: rows.length,
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
  const { data: pendingWps, error } = await supabase
    .from("work_packages")
    .select("id, code, project_id, updated_at")
    .eq("status", "pending_approval");
  if (error) throw error;
  const rows = pendingWps ?? [];
  if (rows.length === 0) return summarizePendingApprovals(rows, new Map());

  const projectIds = Array.from(new Set(rows.map((w) => w.project_id)));
  const { data: projects } = await supabase
    .from("projects")
    .select("id, code, name")
    .in("id", projectIds);
  const projectsById = new Map((projects ?? []).map((p) => [p.id, { code: p.code, name: p.name }]));
  return summarizePendingApprovals(rows, projectsById);
}
