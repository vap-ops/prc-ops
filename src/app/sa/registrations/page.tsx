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
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { RegistrationQueueList } from "@/components/features/registrations/registration-queue-list";
import {
  listVisibleTechnicianRegistrations,
  listLiveAttachmentPurposes,
} from "@/lib/register/admin-registrations";
import { buildRegistrationQueueRow } from "@/lib/register/registration-queue-view";

export const metadata = { title: "คำขอสมัครเป็นช่าง (ดูอย่างเดียว)" };

export default async function SaTechnicianRegistrationsPage() {
  const ctx = await requireRole(["site_admin"]);
  const supabase = await createClient();

  // RLS already scopes this to the pending queue for site_admin
  // (can_see_technician_registration — migration 20260813071300).
  const registrations = await listVisibleTechnicianRegistrations(supabase);
  const purposesByRegistration = await listLiveAttachmentPurposes(
    supabase,
    registrations.map((r) => r.id),
  );

  const rows = registrations.map((r) =>
    buildRegistrationQueueRow({
      id: r.id,
      employeeId: r.employee_id,
      fullName: r.full_name,
      status: r.status,
      createdAt: r.created_at,
      uploadedPurposes: purposesByRegistration.get(r.id) ?? [],
    }),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/sa" backLabel="กลับไปหน้าหลัก">
        <h1 className="text-ink text-xl font-semibold tracking-tight">
          คำขอสมัครเป็นช่าง (ดูอย่างเดียว)
        </h1>
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
