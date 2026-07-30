// Spec 264 G3 / ADR 0072 §8 + spec 266 U7 (C) — the /technician home is a ช่าง's
// OWN portal (a ช่าง logs in as role `technician`).
//
// Spec 376 U3 (D3): this is now the DAILY half of a three-tab surface, not one
// long scroll. The QR badge leads — it is the physical artifact a ช่าง is asked
// for at the morning talk, where the e-employee card that used to lead is
// read-once identity — then the assigned work, then identity: e-card, ID-card
// renewal, and the slimmed WorkerPortalSections (contact + consents). The money
// half (รายการรอรับ, wage history, bank) moved to the ประวัติ tab
// (/technician/history) with its reads; nothing was dropped, only re-homed.
//
// Data reads on the RLS SESSION client (never admin): the G1 own-row policy scopes
// staff_registrations/attachments/storage to auth.uid(); the worker reads
// (get_my_worker_profile / consents) self-scope on the workers.user_id binding.
// No 'use client' — a plain Server Component (the interactive bits are
// already-'use client' children).

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { NotificationReadinessBanner } from "@/components/features/notifications/readiness-banner";
import { readinessFromUserRow } from "@/lib/notifications/readiness";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { AssignedWorkCard } from "@/components/features/technician/assigned-work-card";
import { buildAssignedWorkView } from "@/lib/technician/assigned-work-view";
import { EmployeeCard } from "@/components/features/register/employee-card";
import { WorkerBadgeQr } from "@/components/features/common/worker-badge-qr";
import { toWorkerBadgeQrSvg } from "@/lib/muster/badge-qr";
import { resolveCardPhoto } from "@/lib/register/card-view";
import {
  getOwnTechnicianRegistration,
  getOwnRegistrationDocuments,
} from "@/lib/register/own-registration";
import { WorkerPortalSections } from "@/components/features/portal/worker-portal-sections";
import { WorkerIdCardUpdate } from "@/components/features/portal/worker-id-card-update";
import { ViewAsEmptyNote } from "@/components/features/chrome/view-as-empty-note";
import { type PortalConsent } from "@/components/features/portal/portal-self-edit";

export const metadata = { title: "หน้าหลักช่าง" };

export default async function TechnicianHomePage() {
  const { id: uid, role } = await requireRole(["technician"]);
  const supabase = await createClient();

  const { data: userRow } = await supabase
    .from("users")
    // + spec 318 U2 readiness columns — same self-read, no extra round-trip.
    .select(
      "line_avatar_url, line_user_id, line_oa_friend, line_oa_friend_checked_at, telegram_chat_id",
    )
    .eq("id", uid)
    .maybeSingle();
  // Spec 318 U2 — OA-friend readiness (renders only on a confirmed non-friend).
  const readiness = userRow ? readinessFromUserRow(userRow) : null;

  const registration = await getOwnTechnicianRegistration(supabase, uid);
  const { urls } = registration
    ? await getOwnRegistrationDocuments(supabase, registration.id)
    : { urls: {} };

  // Spec 266 U7 (C) — a ช่าง's own portal lives here. Their profile + consents are
  // RLS-self-scoped (workers.user_id binding), read on the same session client.
  // Every technician is a bound worker (approve + claim both set workers.user_id),
  // so wp is normally present.
  const { data: workerProfileRows } = await supabase.rpc("get_my_worker_profile");
  const wp = workerProfileRows?.[0] ?? null;
  const [
    { data: workerConsentRows },
    // Spec 306 U3a — the caller's own workers.id for their muster check-in QR
    // (self-scoped; null for non-workers). Batched here to avoid an extra hop.
    { data: workerId },
    { data: assignedWork },
  ] = await Promise.all([
    supabase
      .from("contractor_consents")
      .select("id, kind, consented_at, revoked_at")
      .order("created_at", { ascending: false }),
    supabase.rpc("current_user_worker_id"),
    // Spec 350 U2 — the caller's most-recent muster team's assigned WPs + progress.
    supabase.rpc("get_my_assigned_work"),
  ]);

  const assignedWorkView = buildAssignedWorkView(assignedWork ?? []);

  // Spec 306 U3a — present the QR on their home so they can show it at the morning
  // talk instead of carrying a printed badge. Payload = the caller's workers.id
  // (a technician is always a bound worker; uid fallback is defensive).
  const badgeSvg = await toWorkerBadgeQrSvg(workerId ?? uid);

  return (
    <PageShell>
      <BottomTabBar role={role} />
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <h1 className="text-title text-ink min-w-0 truncate font-bold tracking-tight">
            หน้าหลักช่าง
          </h1>
          <LogoutButton />
        </div>
      </header>
      <HubNav
        maxWidthClass={PAGE_MAX_W}
        items={hubNavForRole(role) ?? []}
        currentHref="/technician"
        role={role}
      />

      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 pt-6 pb-28`}>
        <ViewAsEmptyNote />
        <NotificationReadinessBanner readiness={readiness} />

        {/* Spec 376 U3 — the daily physical artifact leads the page. */}
        <WorkerBadgeQr svg={badgeSvg} />

        <AssignedWorkCard view={assignedWorkView} />

        {registration ? (
          <EmployeeCard
            employeeId={registration.employee_id}
            fullName={registration.full_name}
            status={registration.status}
            photoUrl={resolveCardPhoto(
              urls.profile_photo ?? null,
              userRow?.line_avatar_url ?? null,
            )}
          />
        ) : null}

        {/* Spec 315 U1 — ID-card renewal (self-serve supersede) once approved. */}
        {registration?.status === "approved" ? (
          <WorkerIdCardUpdate uid={uid} currentUrl={urls.id_card ?? null} />
        ) : null}

        {/* Spec 266 U7 (C) → 376 U3: the identity half — contact + consents. */}
        {wp ? (
          <div>
            <WorkerPortalSections wp={wp} consents={(workerConsentRows ?? []) as PortalConsent[]} />
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}
