// Spec 264 G3 / ADR 0072 §8 + spec 266 U7 (C) — the /technician home is a ช่าง's
// OWN portal (a ช่าง logs in as role `technician`). It carries: the person's
// e-employee card + approval status (from their staff_registration, if any), an
// "assigned WPs — coming soon" placeholder, AND their worker portal — wage
// history, profile, bank, consents, receipts (WorkerPortalSections, moved here
// from the subcontractor /portal so the two tiers no longer share a page).
//
// Data reads on the RLS SESSION client (never admin): the G1 own-row policy scopes
// staff_registrations/attachments/storage to auth.uid(); the worker reads
// (get_my_worker_profile / get_my_wage_payments / consents / receipts / pending
// bank) self-scope on the workers.user_id binding. No 'use client' — a plain
// Server Component (the interactive bits are already-'use client' children).

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { NotificationReadinessBanner } from "@/components/features/notifications/readiness-banner";
import { readinessFromUserRow } from "@/lib/notifications/readiness";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { LogoutButton } from "@/components/auth/logout-button";
import { ComingSoonBadge } from "@/components/features/chrome/coming-soon-badge";
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
import { type PortalReceipt } from "@/components/features/portal/portal-receipts";
import { type PortalConsent } from "@/components/features/portal/portal-self-edit";

export const metadata = { title: "หน้าหลักช่าง" };

export default async function TechnicianHomePage() {
  const { id: uid } = await requireRole(["technician"]);
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

  // Spec 266 U7 (C) — a ช่าง's own portal lives here. Their profile + wage /
  // consents / receipts / pending-bank are RLS-self-scoped (workers.user_id
  // binding), read on the same session client. Every technician is a bound worker
  // (approve + claim both set workers.user_id), so wp is normally present.
  const { data: workerProfileRows } = await supabase.rpc("get_my_worker_profile");
  const wp = workerProfileRows?.[0] ?? null;
  const [
    { data: workerPayments },
    { data: workerConsentRows },
    { data: receiptRows },
    { data: pendingBankRows },
    // Spec 306 U3a — the caller's own workers.id for their muster check-in QR
    // (self-scoped; null for non-workers). Batched here to avoid an extra hop.
    { data: workerId },
    { data: ownWorkerRow },
  ] = await Promise.all([
    supabase.rpc("get_my_wage_payments"),
    supabase
      .from("contractor_consents")
      .select("id, kind, consented_at, revoked_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("stock_issues")
      .select(
        "id, qty, unit, catalog_items ( base_item, spec_attrs ), work_packages ( code, name )",
      )
      .is("received_at", null)
      .order("issued_at", { ascending: false }),
    supabase.from("worker_bank_change_requests").select("id").eq("status", "pending").limit(1),
    supabase.rpc("current_user_worker_id"),
    // Spec 328 U3 — is this ช่าง a contractor-tied (pay-exempt) member?
    // Self-scoped RLS read ("workers readable by self (portal)"); tied ⇒ the
    // bank section is hidden below (the firm pays them, PRC holds no bank).
    // get_my_worker_profile doesn't return contractor_id, hence the extra read.
    supabase.from("workers").select("contractor_id").eq("user_id", uid).maybeSingle(),
  ]);

  const bankExempt = ownWorkerRow?.contractor_id != null;

  // Spec 306 U3a — present the QR on their home so they can show it at the morning
  // talk instead of carrying a printed badge. Payload = the caller's workers.id
  // (a technician is always a bound worker; uid fallback is defensive).
  const badgeSvg = await toWorkerBadgeQrSvg(workerId ?? uid);
  const receipts: PortalReceipt[] = (receiptRows ?? []).map((r) => ({
    id: r.id,
    baseItem: r.catalog_items?.base_item ?? "",
    specAttrs: r.catalog_items?.spec_attrs ?? null,
    unit: r.unit,
    qty: Number(r.qty),
    wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : "",
  }));

  return (
    <PageShell>
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <h1 className="text-title text-ink min-w-0 truncate font-bold tracking-tight">
            หน้าหลักช่าง
          </h1>
          <LogoutButton />
        </div>
      </header>

      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-6`}>
        <ViewAsEmptyNote />
        <NotificationReadinessBanner readiness={readiness} />
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

        <WorkerBadgeQr svg={badgeSvg} />

        {/* Spec 315 U1 — ID-card renewal (self-serve supersede) once approved. */}
        {registration?.status === "approved" ? (
          <WorkerIdCardUpdate uid={uid} currentUrl={urls.id_card ?? null} />
        ) : null}

        <div className={CARD}>
          <div className="flex items-center gap-2">
            <p className="text-ink text-sm font-semibold">งานที่ได้รับมอบหมาย</p>
            <ComingSoonBadge />
          </div>
          <p className="text-ink-secondary mt-1 text-sm">
            รายการงานที่คุณได้รับมอบหมายจะแสดงที่นี่ เร็ว ๆ นี้
          </p>
        </div>

        {/* Spec 266 U7 (C): the ช่าง's own portal — wage, profile, bank, receipts. */}
        {wp ? (
          <div>
            <WorkerPortalSections
              uid={uid}
              wp={wp}
              payments={workerPayments ?? []}
              consents={(workerConsentRows ?? []) as PortalConsent[]}
              receipts={receipts}
              hasPendingBank={(pendingBankRows?.length ?? 0) > 0}
              bankExempt={bankExempt}
            />
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}
