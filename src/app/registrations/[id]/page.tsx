// Spec 263 U3 — the back-office review detail: applicant fields + the
// uploaded docs (server-minted signed URLs) + approve/reject. Same gate as the
// queue list (TECHNICIAN_APPROVAL_ROLES) — route gate === page gate, no drift.
// RLS (can_see_technician_registration) scopes the row read; notFound() when
// the id doesn't resolve (deleted/never existed) rather than a silent blank
// page — the RLS-denied case (SA/site_owner opening someone else's non-pending
// row, or a role outside the gate entirely) never reaches here since requireRole
// already redirected.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { TECHNICIAN_APPROVAL_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { isValidUuid } from "@/lib/validate/uuid";
import { EmployeeCard } from "@/components/features/register/employee-card";
import { RegistrationDocumentsView } from "@/components/features/registrations/registration-documents-view";
import { RegistrationDecision } from "@/components/features/registrations/registration-decision";
import {
  getTechnicianRegistrationById,
  getRegistrationDocumentUrls,
} from "@/lib/register/admin-registrations";
import { formatThaiDateTime } from "@/lib/i18n/labels";

export const metadata = { title: "รายละเอียดคำขอสมัคร" };

export default async function TechnicianRegistrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const ctx = await requireRole(TECHNICIAN_APPROVAL_ROLES);
  const supabase = await createClient();

  const registration = await getTechnicianRegistrationById(supabase, id);
  if (!registration) notFound();

  const { urls } = await getRegistrationDocumentUrls(supabase, id);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/registrations" backLabel="กลับไปคำขอสมัคร">
        <h1 className="text-ink text-xl font-semibold tracking-tight">รายละเอียดคำขอสมัคร</h1>
      </DetailHeader>

      <section className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-4 px-5 py-6`}>
        <EmployeeCard
          employeeId={registration.employee_id}
          fullName={registration.full_name}
          status={registration.status}
          photoUrl={urls.profile_photo ?? null}
        />

        <div className={CARD}>
          <p className="text-ink text-sm font-semibold">ข้อมูลผู้สมัคร</p>
          <dl className="text-ink-secondary mt-2 space-y-1.5 text-sm">
            <Row label="เบอร์โทร" value={registration.phone} />
            <Row label="วันเกิด" value={registration.date_of_birth} />
            <Row label="ผู้ติดต่อฉุกเฉิน" value={registration.emergency_contact_name} />
            <Row label="ความสัมพันธ์" value={registration.emergency_contact_relation} />
            <Row label="เบอร์ติดต่อฉุกเฉิน" value={registration.emergency_contact_phone} />
            <Row label="ส่งคำขอเมื่อ" value={formatThaiDateTime(registration.created_at)} />
            {registration.status === "rejected" && registration.reject_reason ? (
              <Row label="เหตุผลที่ปฏิเสธ" value={registration.reject_reason} />
            ) : null}
          </dl>
        </div>

        <RegistrationDocumentsView urls={urls} />

        {registration.status === "pending" ? (
          <RegistrationDecision registrationId={registration.id} />
        ) : null}
      </section>
    </PageShell>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted w-32 shrink-0">{label}</dt>
      <dd className="break-words">{value ?? "—"}</dd>
    </div>
  );
}
