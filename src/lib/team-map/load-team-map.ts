import "server-only";

// Spec 330 U1 — the team-map page loader. Session-client reads (RLS
// can_see_project arms; workers PII wall untouched — open columns only) plus
// the ADR 0011 admin seam for users names/roles (public.users is read-self;
// identical seam to the project-settings page). One batched wave.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient as createAdminClient } from "@/lib/db/admin";
import type { Database } from "@/lib/db/database.types";
import { PROJECT_TEAM_STAFF_ROLES } from "@/lib/auth/role-home";
import { buildProjectTeamMap, type ProjectTeamMap } from "./build-team-map";

export interface TeamMapPageData {
  map: ProjectTeamMap;
  addableStaff: { id: string; name: string | null; role: string }[];
}

export async function loadTeamMapPageData(
  supabase: SupabaseClient<Database>,
  projectId: string,
  projectLeadId: string | null,
): Promise<TeamMapPageData> {
  const admin = createAdminClient();
  const [{ data: members }, { data: workers }, { data: crews }, { data: staff }] =
    await Promise.all([
      supabase
        .from("project_members")
        .select("user_id, is_primary")
        .eq("project_id", projectId)
        .order("added_at"),
      supabase
        .from("workers")
        .select("id, name, contractor_id")
        .eq("project_id", projectId)
        .eq("active", true)
        .order("name"),
      // Nested read rides the crew_members FK; RLS filters both layers.
      supabase
        .from("crews")
        .select("id, name, lead_worker_id, active, crew_members(crew_id, worker_id, removed_at)")
        .eq("project_id", projectId),
      // Admin seam: names + roles for the picker AND for member rows (users
      // RLS is read-self — ADR 0011). Only open identity columns leave here.
      admin
        .from("users")
        .select("id, full_name, role")
        .in("role", [...PROJECT_TEAM_STAFF_ROLES])
        .order("full_name", { nullsFirst: false }),
    ]);

  const memberRows = members ?? [];
  const staffRows = staff ?? [];
  const users = new Map(staffRows.map((u) => [u.id, { name: u.full_name, role: u.role }]));

  // A member/lead whose role left the picker set (or role changed) still needs
  // a name on the map — fetch the leftovers by id through the same seam.
  const knownIds = new Set(users.keys());
  const missingIds = [
    ...new Set(
      [...memberRows.map((m) => m.user_id), ...(projectLeadId ? [projectLeadId] : [])].filter(
        (id) => !knownIds.has(id),
      ),
    ),
  ];
  if (missingIds.length > 0) {
    const { data: extra } = await admin
      .from("users")
      .select("id, full_name, role")
      .in("id", missingIds);
    for (const u of extra ?? []) users.set(u.id, { name: u.full_name, role: u.role });
  }

  // Firm names for the contractor cards (privileged-role SELECT policy).
  const contractorIds = [
    ...new Set((workers ?? []).map((w) => w.contractor_id).filter((id): id is string => !!id)),
  ];
  const contractors = new Map<string, string>();
  if (contractorIds.length > 0) {
    const { data: firms } = await supabase
      .from("contractors")
      .select("id, name")
      .in("id", contractorIds);
    for (const f of firms ?? []) contractors.set(f.id, f.name);
  }

  const crewRows = crews ?? [];
  const map = buildProjectTeamMap({
    projectLeadId,
    members: memberRows,
    users,
    workers: workers ?? [],
    crews: crewRows.map((c) => ({
      id: c.id,
      name: c.name,
      lead_worker_id: c.lead_worker_id,
      active: c.active,
    })),
    crewMembers: crewRows.flatMap((c) => c.crew_members),
    contractors,
  });

  const memberIds = new Set(memberRows.map((m) => m.user_id));
  const addableStaff = staffRows
    .filter((u) => !memberIds.has(u.id))
    .map((u) => ({ id: u.id, name: u.full_name, role: u.role }));

  return { map, addableStaff };
}
