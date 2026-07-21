// Spec 263 U3 — the SA read-only view of technician registrations. Gate =
// site_admin (the brief scopes this surface to SA; super_admin already reaches
// everything via /registrations). Surfaced honestly: because a pending
// registration carries no project edge (human Web-Share routing, not a project
// picker — spec 263 RLS scope note), this is the PENDING QUEUE READ-ONLY, not a
// project-scoped list — no approve/reject affordance, ever (that's the back-office
// queue at /registrations). RLS (can_see_technician_registration) already narrows
// the read to pending rows for site_admin, so no extra status filter is needed
// here — it mirrors the DB's own scope rather than re-deriving it.
//
// Drilled down from /sa (back chip → /sa) — site_admin's daily home.

import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { safeBackHref } from "@/lib/nav/back-href";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { RegistrationQueueList } from "@/components/features/registrations/registration-queue-list";
import {
  listVisibleTechnicianRegistrations,
  listLiveAttachmentPurposes,
  listContractorNames,
} from "@/lib/register/admin-registrations";
import { buildRegistrationQueueRow } from "@/lib/register/registration-queue-view";
import { listRegistrationsWithBank } from "@/lib/register/admin-registration-bank";

export const metadata = { title: "คำขอสมัคร (ดูอย่างเดียว)" };

// Nav-coherence audit 2026-07: multi-parent (reached from /sa AND the /team hub) —
// back chip resolves ?from, else /sa (site_admin's daily home).
export default async function SaStaffRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole(["site_admin"]);
  const supabase = await createClient();

  // RLS already scopes this to the pending queue for site_admin
  // (can_see_technician_registration — migration 20260813071300).
  const registrations = await listVisibleTechnicianRegistrations(supabase);
  const ids = registrations.map((r) => r.id);
  // Spec 328 U3 — firm names for the invited-firm chips (RLS-scoped read;
  // contractors are readable by site_admin via the privileged-roles policy).
  const invitedFirmIds = [
    ...new Set(
      registrations.map((r) => r.invited_contractor_id).filter((v): v is string => v !== null),
    ),
  ];
  const [purposesByRegistration, bankByRegistration, firmNames] = await Promise.all([
    listLiveAttachmentPurposes(supabase, ids),
    listRegistrationsWithBank(ids),
    listContractorNames(supabase, invitedFirmIds),
  ]);

  const rows = registrations.map((r) =>
    buildRegistrationQueueRow({
      id: r.id,
      employeeId: r.employee_id,
      fullName: r.full_name,
      status: r.status,
      createdAt: r.created_at,
      uploadedPurposes: purposesByRegistration.get(r.id) ?? [],
      hasBank: bankByRegistration.has(r.id),
      hasReviewerNote: Boolean(r.reject_reason && r.reject_reason.trim()),
      invitedFirm: r.invited_contractor_id
        ? { id: r.invited_contractor_id, name: firmNames.get(r.invited_contractor_id) ?? null }
        : null,
      documentsDeferredAt: r.documents_deferred_at,
    }),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/sa")} backLabel="กลับไปหน้าหลัก">
        <h1 className="text-ink text-xl font-semibold tracking-tight">คำขอสมัคร (ดูอย่างเดียว)</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <RegistrationQueueList
          rows={rows}
          detailHrefFor={(id) => `/sa/registrations/${id}`}
          emptyMessage="ไม่มีคำขอสมัครที่รออนุมัติ"
        />
      </section>
    </PageShell>
  );
}
