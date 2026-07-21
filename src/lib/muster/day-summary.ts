// Spec 334 U1 — the /team hero's narrow read. Deliberately NOT loadMusterBoard:
// the hub needs three numbers, not the cockpit's full editing surface.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

type ServerClient = SupabaseClient<Database>;

export interface MusterDaySummary {
  state: "not_started" | "open" | "closed";
  present: number; // distinct workers with in_at today
  expected: number; // active workers on the project
  closedAt: string | null;
}

export function summariseMusterDay(raw: {
  teamCount: number;
  attendanceWorkerIds: string[]; // worker_id per attendance row, dupes possible
  expected: number;
  closure: { closed_at: string } | null;
}): MusterDaySummary {
  const present = new Set(raw.attendanceWorkerIds).size;
  const base = { present, expected: raw.expected };
  if (raw.closure) return { ...base, state: "closed", closedAt: raw.closure.closed_at };
  if (raw.teamCount === 0) return { ...base, state: "not_started", closedAt: null };
  return { ...base, state: "open", closedAt: null };
}

export async function loadMusterDaySummary(
  supabase: ServerClient,
  projectId: string,
  date: string,
): Promise<MusterDaySummary> {
  // teams today (ids only) → attendance worker_ids over those ids → closure → active-worker count.
  // Every read is null-tolerant: a failed read degrades to [] / null / 0, never throws —
  // spec U1 negative case "card falls back to not_started, never blanks the hub".
  const { data: teams } = await supabase
    .from("muster_teams")
    .select("id")
    .eq("project_id", projectId)
    .eq("work_date", date);
  const teamIds = (teams ?? []).map((t) => t.id);

  // in_at is set by scan; a muster_attendance row IS presence — distinct count lives in the shaper.
  const attendance = teamIds.length
    ? (await supabase.from("muster_attendance").select("worker_id").in("team_id", teamIds)).data
    : [];

  const { data: closure } = await supabase
    .from("muster_day_closures")
    .select("closed_at")
    .eq("project_id", projectId)
    .eq("work_date", date)
    .maybeSingle();

  const { count } = await supabase
    .from("workers")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("active", true);

  return summariseMusterDay({
    teamCount: teamIds.length,
    attendanceWorkerIds: (attendance ?? []).map((a) => a.worker_id),
    expected: count ?? 0,
    closure: closure ?? null,
  });
}
