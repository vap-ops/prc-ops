// Spec 264 G3 / ADR 0072 §8 + spec 266 U7 (C) — the /technician home is a ช่าง's
// OWN portal (a ช่าง logs in as role `technician`).
//
// Spec 376 U3 (D3) split this page into a daily half and a ประวัติ tab. Specs 388
// U2–U4 then reversed most of that split on evidence — the tab had never been
// opened — and 388 U3 (D1) removes it from the bar entirely, leaving a TWO-tab
// role (หน้าหลัก + ตั้งค่า). So this page is once again a ช่าง's whole app, but
// ordered by what they came for rather than by what existed first:
//   QR badge → รายการรอรับ (their only write) → assigned work →
//   ประวัติการเข้างาน (a row; this page is that route's only door now) → identity
//   (e-card, ID-card renewal, contact + consents, bank, wage list when non-empty).
//
// Data reads on the RLS SESSION client (never admin): the G1 own-row policy scopes
// staff_registrations/attachments/storage to auth.uid(); the worker reads
// (get_my_worker_profile / consents) self-scope on the workers.user_id binding.
// No 'use client' — a plain Server Component (the interactive bits are
// already-'use client' children).

import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
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
import { WorkerHistorySections } from "@/components/features/portal/worker-history-sections";
import { PortalReceipts, type PortalReceipt } from "@/components/features/portal/portal-receipts";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { ATTENDANCE_OWN_LABEL } from "@/lib/i18n/labels";
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
    // Spec 388 U2 (D4/D5) — the reads that came back from /technician/history
    // when that route became attendance. Each is already RLS-self-scoped on the
    // workers.user_id binding; moved verbatim, not re-invented.
    { data: workerPayments },
    { data: receiptRows },
    { data: pendingBankRows },
    { data: ownWorkerRow },
  ] = await Promise.all([
    supabase
      .from("contractor_consents")
      .select("id, kind, consented_at, revoked_at")
      .order("created_at", { ascending: false }),
    supabase.rpc("current_user_worker_id"),
    // Spec 350 U2 — the caller's most-recent muster team's assigned WPs + progress.
    supabase.rpc("get_my_assigned_work"),
    supabase.rpc("get_my_wage_payments"),
    supabase
      .from("stock_issues")
      .select(
        "id, qty, unit, catalog_items ( base_item, spec_attrs ), work_packages ( code, name )",
      )
      .is("received_at", null)
      .order("issued_at", { ascending: false }),
    supabase.from("worker_bank_change_requests").select("id").eq("status", "pending").limit(1),
    // Spec 328 U3 — is this ช่าง contractor-tied (pay-exempt)? Tied ⇒ the bank
    // section is hidden (the firm pays them, PRC holds no bank).
    // get_my_worker_profile doesn't return contractor_id, hence the extra read.
    supabase.from("workers").select("contractor_id").eq("user_id", uid).maybeSingle(),
  ]);

  const assignedWorkView = buildAssignedWorkView(assignedWork ?? []);
  const bankExempt = ownWorkerRow?.contractor_id != null;
  const receipts: PortalReceipt[] = (receiptRows ?? []).map((r) => ({
    id: r.id,
    baseItem: r.catalog_items?.base_item ?? "",
    specAttrs: r.catalog_items?.spec_attrs ?? null,
    unit: r.unit,
    qty: Number(r.qty),
    wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : "",
  }));

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

        {/* Spec 388 U2 (D5) — รายการรอรับ, lifted out of the ประวัติ tab. It is
            the ONLY write a ช่าง owns anywhere in the app, and it sat behind a
            money-labelled tab with 0 route views all-time, which is the best
            available explanation for zero technician writes in 30 days. It
            belongs directly under the QR, above the assigned work, because it is
            the one thing on this page that asks the ช่าง to DO something. */}
        <section>
          <h2 className={SECTION_HEADING}>รายการรอรับ</h2>
          <PortalReceipts receipts={receipts} />
        </section>

        <AssignedWorkCard view={assignedWorkView} />

        {/* Spec 388 U3 (D1) — ประวัติการเข้างาน's ONLY door. It was a tab until this
            unit; the bar is now หน้าหลัก + ตั้งค่า, so without this row the page is
            unreachable by any tap a ช่าง can make. Placed below the two things
            that ask for action (receipts, assigned work) and above identity: it
            answers a question, it does not request anything. */}
        <Link
          href="/technician/history"
          className={`${CARD} focus-visible:ring-action flex items-center gap-3 focus:outline-none focus-visible:ring-2`}
        >
          <CalendarDays aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="text-ink text-body block font-semibold">{ATTENDANCE_OWN_LABEL}</span>
            <span className="text-ink-secondary text-meta block">
              เวลาเข้า-ออกงานของคุณ ย้อนหลังรายเดือน
            </span>
          </span>
          <ChevronRight aria-hidden className="text-ink-muted h-5 w-5 shrink-0" />
        </Link>

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

        {/* Spec 388 U2 (D4) — the money block returns from /technician/history,
            which is now attendance. It sits with identity rather than at the top:
            a ช่าง opens this page for the QR and the receipts, not for their bank.
            The wage list inside renders only when non-empty (wage_payments is 0
            rows all-time), so today this is the bank card alone — and that is the
            page /settings/my-info has always pointed at by name. */}
        {wp ? (
          <div>
            <WorkerHistorySections
              uid={uid}
              wp={wp}
              payments={workerPayments ?? []}
              hasPendingBank={(pendingBankRows?.length ?? 0) > 0}
              bankExempt={bankExempt}
            />
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}
