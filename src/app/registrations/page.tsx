// Spec 263 U3 — the back-office technician-registration approval queue. Gate =
// TECHNICIAN_APPROVAL_ROLES (procurement_manager/project_director/super_admin —
// role-home.ts, mirrors the U1c RPCs' inline literal EXACTLY: the route gate
// MUST equal the page gate, the anti-pattern named on that constant's comment).
// Drilled down from the PM hub strip (back chip → /dashboard, the PM_ROLES home).

import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { TECHNICIAN_APPROVAL_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { RegistrationQueueList } from "@/components/features/registrations/registration-queue-list";
import {
  listVisibleTechnicianRegistrations,
  listLiveAttachmentPurposes,
} from "@/lib/register/admin-registrations";
import { buildRegistrationQueueRow } from "@/lib/register/registration-queue-view";

export const metadata = { title: "คำขอสมัครเป็นช่าง" };

export default async function TechnicianRegistrationQueuePage() {
  const ctx = await requireRole(TECHNICIAN_APPROVAL_ROLES);
  const supabase = await createClient();

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
      <DetailHeader backHref="/dashboard" backLabel="กลับไปหน้าภาพรวม">
        <h1 className="text-ink text-xl font-semibold tracking-tight">คำขอสมัครเป็นช่าง</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <RegistrationQueueList
          rows={rows}
          detailHrefFor={(id) => `/registrations/${id}`}
          emptyMessage="ไม่มีคำขอสมัคร"
        />
      </section>
    </PageShell>
  );
}
