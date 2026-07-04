// Spec 263 U3 — the SA's read-only registration detail. Same data + document
// rendering as the back-office review detail, minus the approve/reject control
// (SA never decides — read-only per the spec's RLS scope note). RLS
// (can_see_technician_registration) scopes site_admin to pending rows only, so
// a non-pending id 404s here even though it may be visible at /registrations.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD } from "@/lib/ui/classes";
import { isValidUuid } from "@/lib/validate/uuid";
import { EmployeeCard } from "@/components/features/register/employee-card";
import { RegistrationDocumentsView } from "@/components/features/registrations/registration-documents-view";
import {
  getTechnicianRegistrationById,
  getRegistrationDocumentUrls,
} from "@/lib/register/admin-registrations";
import { formatThaiDateTime } from "@/lib/i18n/labels";

export const metadata = { title: "รายละเอียดคำขอสมัคร" };

export default async function SaTechnicianRegistrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const ctx = await requireRole(["site_admin"]);
  const supabase = await createClient();

  const registration = await getTechnicianRegistrationById(supabase, id);
  if (!registration) notFound();

  const { urls } = await getRegistrationDocumentUrls(supabase, id);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/sa/registrations" backLabel="กลับไปคำขอสมัคร">
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
            <Row label="ส่งคำขอเมื่อ" value={formatThaiDateTime(registration.created_at)} />
          </dl>
        </div>

        <RegistrationDocumentsView urls={urls} />
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
