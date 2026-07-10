import "server-only";

// Spec 291 U2 (TASK 6) — a pure, RLS-scoped loader for the /profile employee-ID
// card: identity + STATUSES ONLY, never any PDPA-sensitive value (see spec
// 291 "Never rendered on profile" list). Mirrors the own-registration.ts idiom
// (src/lib/register/own-registration.ts): the caller's own RLS session does
// every read — never the admin/service-role client — so a missing row is just
// "not visible to me", not an error.
//
// EMPLOYEES ONLY. This card renders for internal roles; the external roles
// (client/contractor) and pre-role visitor never see it (spec 291 §Unit 2). An
// employee's identity records are `staff_registrations` + `staff_consents`, so
// this loader reads exactly those. There are deliberately NO crew/contractor
// fallbacks: crew_registrations has no `user_id` and is revoked from
// `authenticated` entirely (DEFINER-RPC-only staging data) → an own-row read is
// neither expressible nor granted, and contractor_consents belongs to external
// contractors who never get a card. Both would be dead (and the unfiltered crew
// query a latent risk if grants ever changed).
//
// Gate-check finding (live schema, 2026-07-10): departments has no `name`
// column — only `name_th`/`name_en`. Uses `name_th`, matching the app-wide
// convention (src/lib/org/org-chart.ts, src/lib/accounting/load-dashboard.ts
// both surface `name_th` as the display name).

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

  // Registration = the employee's own staff_registrations row (most recent).
  // RLS's own-row policy scopes it to the caller (user_id = auth.uid()).
  const { data: registration } = await supabase
    .from("staff_registrations")
    .select("employee_id, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // PDPA consent = the employee's latest staff_consents row. RLS's own-row
  // policy scopes it to the caller (user_id = auth.uid()).
  const { data: consent } = await supabase
    .from("staff_consents")
    .select("consented_at, revoked_at")
    .eq("user_id", userId)
    .eq("kind", "pdpa_data")
    .order("consented_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    fullName: user.full_name,
    role: user.role,
    avatarUrl: user.line_avatar_url,
    departmentName,
    employeeId: registration?.employee_id ?? null,
    registration: registration ? { status: registration.status } : null,
    pdpaConsent: consent
      ? { status: consent.revoked_at === null ? "given" : "revoked", at: consent.consented_at }
      : null,
  };
}
