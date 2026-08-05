// Spec 397 U5 — the office team's board.
//
// A DIFFERENT shape from the crew board, not a copy of it. The crew board groups
// by หัวหน้าชุด, seeds a WP set, prefills from the lead's last day and lists
// ยังไม่มา from their crew roster. An office team has none of those: it is
// leadless by design (U4), binds no WP (§8 — that would be a wage path), and has
// no roster to be absent from. What it has is: is it open, who is in, who can
// still be added.
//
// Pure fold + a thin fetch, the house split — so every rule below is unit-tested
// without a database.

import type { createClient } from "@/lib/db/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface OfficeMember {
  workerId: string;
  name: string;
  inAt: string | null;
  outAt: string | null;
}

export interface OfficeBoard {
  /** null until someone opens today's office team. */
  teamId: string | null;
  members: OfficeMember[];
  /** Office-class workers who may still be added today. */
  addable: { id: string; name: string }[];
  /**
   * How many office-class people exist on this project at all. Distinguishes "the
   * roster is empty" from "everyone is already in" — two states whose copy must
   * not be the same sentence, and before U6's data op the first is the live one.
   */
  rosterSize: number;
  /** Checked in today at all — what the card leads with. */
  presentCount: number;
  /** Still without a check-out. */
  stillInCount: number;
}

export function shapeOfficeBoard(raw: {
  team: { id: string } | null;
  attendance: { worker_id: string; in_at: string | null; out_at: string | null }[];
  workers: { id: string; name: string }[];
  /** Worker ids already mustered ANYWHERE today (crew teams included). */
  mustered: string[];
}): OfficeBoard {
  const nameById = new Map(raw.workers.map((w) => [w.id, w.name]));
  // Oldest check-in first: the list reads as the order people arrived.
  const ordered = [...raw.attendance].sort((a, b) => (a.in_at ?? "").localeCompare(b.in_at ?? ""));
  const members: OfficeMember[] = ordered.map((a) => ({
    workerId: a.worker_id,
    // A deactivated worker who already checked in must not vanish from the day's
    // record — same fallback the crew board uses rather than dropping the row.
    name: nameById.get(a.worker_id) ?? "—",
    inAt: a.in_at,
    outAt: a.out_at,
  }));

  const inOffice = new Set(members.map((m) => m.workerId));
  const elsewhere = new Set(raw.mustered);
  // Anyone already mustered today — here or in a crew — is excluded rather than
  // offered: `muster_scan_in` enforces one team per worker per day, so offering
  // them would be a button whose own server refuses it.
  const addable = raw.workers.filter((w) => !inOffice.has(w.id) && !elsewhere.has(w.id));

  return {
    teamId: raw.team?.id ?? null,
    members,
    addable: addable.map((w) => ({ id: w.id, name: w.name })),
    rosterSize: raw.workers.length,
    presentCount: members.length,
    stillInCount: members.filter((m) => m.outAt === null).length,
  };
}

/**
 * Today's office team for a project. Session client throughout — `muster_teams`
 * and `muster_attendance` are RLS-scoped by `can_see_project`, which is exactly
 * the visibility this surface should have.
 */
export async function loadOfficeBoard(
  supabase: ServerClient,
  projectId: string,
  date: string,
): Promise<OfficeBoard> {
  const { data: team } = await supabase
    .from("muster_teams")
    .select("id")
    .eq("project_id", projectId)
    .eq("work_date", date)
    .eq("kind", "office")
    .maybeSingle();

  const [attendanceRes, workersRes, allTeamsRes] = await Promise.all([
    team
      ? supabase
          .from("muster_attendance")
          .select("worker_id, in_at, out_at")
          .eq("team_id", team.id)
          .eq("session", "regular")
      : Promise.resolve({ data: [] }),
    // ⚠️ OFFICE-CLASS ONLY (day_rate = 0), not every active worker on the project.
    // The review caught what an unscoped picker costs: a mis-tapped ช่าง has their
    // real crew check-in refused for the rest of the day (one team per worker per
    // day), and if the day is then closed `derive_muster_labor` books NOTHING for
    // them — the office team binds no work package — so they silently lose that
    // day's wage. `day_rate = 0` IS the office mechanism (§5.1: a rate-0 row is
    // wage-free by construction), so it is the honest discriminator here too.
    supabase
      .from("workers")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("active", true)
      .eq("day_rate", 0)
      .order("name"),
    // Everyone mustered today on this project, so the add list never offers
    // someone the scan RPC will refuse.
    supabase.from("muster_teams").select("id").eq("project_id", projectId).eq("work_date", date),
  ]);

  const teamIds = (allTeamsRes.data ?? []).map((t) => t.id);
  const musteredRes = teamIds.length
    ? await supabase.from("muster_attendance").select("worker_id").in("team_id", teamIds)
    : { data: [] as { worker_id: string }[] };

  return shapeOfficeBoard({
    team: team ?? null,
    attendance: attendanceRes.data ?? [],
    workers: workersRes.data ?? [],
    mustered: (musteredRes.data ?? []).map((a) => a.worker_id),
  });
}
