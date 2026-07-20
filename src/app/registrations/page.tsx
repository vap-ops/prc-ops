// Spec 263 U3 / spec 264 G4 — the back-office staff-registration approval queue
// (role-neutral: the same queue serves every self-onboarded staff role; the
// approver picks the role at approval). Gate = STAFF_APPROVAL_ROLES
// (procurement_manager/project_director/super_admin — role-home.ts, mirrors the
// approve_staff_registration RPC's inline literal EXACTLY: the route gate MUST
// equal the page gate, the anti-pattern named on that constant's comment).
// Spec 313 U3: MULTI-PARENT now. The PM คำขอสมัคร bottom tab folded into ทีมงาน,
// so /team's approver card is the phone's door here, alongside the PM hub strip
// item and the /procurement nudge. The back chip resolves the ?from referrer and
// falls back to /dashboard (the old hardcoded target, still right for the strip).

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { STAFF_APPROVAL_ROLES } from "@/lib/auth/role-home";
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
import { AWAITING_BANK_TITLE } from "@/lib/i18n/labels";
import { safeBackHref } from "@/lib/nav/back-href";

export const metadata = { title: "คำขอสมัคร" };

export default async function StaffRegistrationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole(STAFF_APPROVAL_ROLES);
  const supabase = await createClient();

  const registrations = await listVisibleTechnicianRegistrations(supabase);
  const ids = registrations.map((r) => r.id);
  // Spec 328 U3 — firm names for the invited-firm chips (RLS-scoped read).
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
    }),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/dashboard")} backLabel="กลับไปหน้าภาพรวม">
        <h1 className="text-ink text-xl font-semibold tracking-tight">คำขอสมัคร</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        {/* Spec 298 U3 — jump to the phoneless-worker bank-completion queue. */}
        <Link
          href="/registrations/awaiting-bank"
          className="text-action focus-visible:ring-action inline-flex items-center gap-1 self-start rounded-md text-sm font-medium focus:outline-none focus-visible:ring-2"
        >
          {AWAITING_BANK_TITLE}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
        <RegistrationQueueList
          rows={rows}
          detailHrefFor={(id) => `/registrations/${id}`}
          emptyMessage="ไม่มีคำขอสมัคร"
        />
      </section>
    </PageShell>
  );
}
