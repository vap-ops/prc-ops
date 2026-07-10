import "server-only";

// Spec 291 U2 (TASK 6) — a pure, RLS-scoped loader for the /profile employee-ID
// card: identity + STATUSES ONLY, never any PDPA-sensitive value (see spec
// 291 "Never rendered on profile" list). Mirrors the own-registration.ts idiom
// (src/lib/register/own-registration.ts): the
// caller's own RLS session does every read — never the admin/service-role
// client — so a missing row is just "not visible to me", not an error.
//
// Gate-check findings (live schema, 2026-07-10) vs the original contract:
// - departments has no `name` column — only `name_th`/`name_en`. Uses
//   `name_th`, matching the app-wide convention (src/lib/org/org-chart.ts,
//   src/lib/accounting/load-dashboard.ts both surface `name_th` as the
//   display name).
// - crew_registrations has NO `user_id` column at all (it links to `crews`,
//   not to a user) and `revoke all ... from anon, authenticated` seals the
//   table entirely — it's staged/read only via the crew-lead + approval
//   DEFINER RPCs (supabase/migrations/20260813075430_spec279u2_crew_add_member.sql).
//   So a `user_id` filter isn't even expressible against the generated types,
//   and any select is denied at the grant layer (not just RLS) for every
//   authenticated caller today. The fallback query below still runs (forward
//   compatible if a future migration adds an own-row path) but currently
//   always resolves to null — a fail-closed, not a broken, outcome.
// - contractor_consents has NO `user_id` column either — ownership is scoped
//   by `contractor_id = current_user_contractor_id()` OR
//   `worker_id = current_user_worker_id()` (supabase/migrations/
//   20260709000100_contractor_consents.sql, 20260787000000_polymorphic_consents.sql).
//   There is no correct `.eq(userId)` predicate for this table, so the read
//   below is unfiltered and relies entirely on RLS to scope it to the
//   caller's own row(s) — the same "RLS's own-row policy scopes it further"
//   pattern own-registration.ts already uses.

import type { UserRole } from "@/lib/db/enums";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;

type RegistrationStatus = "pending" | "approved" | "rejected";

export interface ProfileCard {
  fullName: string | null;
  role: UserRole;
  avatarUrl: string | null;
  departmentName: string | null;
  employeeId: string | null;
  registration: { status: RegistrationStatus } | null;
  pdpaConsent: { status: "given" | "revoked"; at: string } | null;
}

interface RegistrationRow {
  employeeId: string;
  status: RegistrationStatus;
}

async function loadRegistration(
  supabase: ServerClient,
  userId: string,
): Promise<RegistrationRow | null> {
  const { data: staff } = await supabase
    .from("staff_registrations")
    .select("employee_id, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (staff) {
    return { employeeId: staff.employee_id, status: staff.status };
  }

  // See the crew_registrations gate-check note above — unfiltered because
  // `user_id` does not exist on this table; currently always denied by grant.
  const { data: crew } = await supabase
    .from("crew_registrations")
    .select("employee_id, status")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return crew ? { employeeId: crew.employee_id, status: crew.status } : null;
}

async function loadPdpaConsent(
  supabase: ServerClient,
  userId: string,
): Promise<{ status: "given" | "revoked"; at: string } | null> {
  const { data: staff } = await supabase
    .from("staff_consents")
    .select("consented_at, revoked_at")
    .eq("user_id", userId)
    .order("consented_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (staff) {
    return { status: staff.revoked_at === null ? "given" : "revoked", at: staff.consented_at };
  }

  // See the contractor_consents gate-check note above — unfiltered because
  // there is no `user_id` column; RLS alone scopes the visible row(s).
  const { data: other } = await supabase
    .from("contractor_consents")
    .select("consented_at, revoked_at")
    .order("consented_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return other
    ? { status: other.revoked_at === null ? "given" : "revoked", at: other.consented_at }
    : null;
}

export async function loadProfileCard(
  supabase: ServerClient,
  userId: string,
): Promise<ProfileCard> {
  const { data: user } = await supabase
    .from("users")
    .select("role, full_name, line_avatar_url, department_id")
    .eq("id", userId)
    .maybeSingle();
  if (!user) {
    // The caller's own users row is created by the auth.users insert trigger
    // (ADR 0007) — an authenticated session always has one. A missing row
    // here means userId doesn't match the caller's own session, which is a
    // programming error, not a normal "no data yet" case.
    throw new Error("loadProfileCard: no users row for the given userId");
  }

  let departmentName: string | null = null;
  if (user.department_id) {
    const { data: dept } = await supabase
      .from("departments")
      .select("name_th")
      .eq("id", user.department_id)
      .maybeSingle();
    departmentName = dept?.name_th ?? null;
  }

  const registration = await loadRegistration(supabase, userId);
  const pdpaConsent = await loadPdpaConsent(supabase, userId);

  return {
    fullName: user.full_name,
    role: user.role,
    avatarUrl: user.line_avatar_url,
    departmentName,
    employeeId: registration?.employeeId ?? null,
    registration: registration ? { status: registration.status } : null,
    pdpaConsent,
  };
}
