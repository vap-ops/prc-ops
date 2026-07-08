// Spec 263 U3 / spec 264 G4 — the back-office review detail: applicant fields +
// the uploaded docs (server-minted signed URLs) + approve/reject with a ROLE
// SELECTOR (the approver picks which role the applicant becomes). Same gate as
// the queue list (STAFF_APPROVAL_ROLES) — route gate === page gate, no drift.
// RLS (can_see_staff_registration) scopes the row read; notFound() when the id
// doesn't resolve (deleted/never existed) rather than a silent blank page — the
// RLS-denied case (SA/site_owner opening someone else's non-pending row, or a
// role outside the gate entirely) never reaches here since requireRole already
// redirected.
//
// Site-assignment follow-up: loads the active-projects list (RLS-session client,
// same pattern as /workers) for RegistrationDecision's optional site selector —
// only when the row is still pending (the selector itself is decision-only).

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { STAFF_APPROVAL_ROLES } from "@/lib/auth/role-home";
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
import { getLineIdentityByUserId } from "@/lib/identity/admin-line-identity";
import { LineIdentityBlock } from "@/components/features/identity/line-identity-block";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { formatThaiDateTime, REGISTRATION_INVITED_BY_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: "รายละเอียดคำขอสมัคร" };

export default async function StaffRegistrationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();

  const ctx = await requireRole(STAFF_APPROVAL_ROLES);
  const supabase = await createClient();

  const registration = await getTechnicianRegistrationById(supabase, id);
  if (!registration) notFound();

  const { urls } = await getRegistrationDocumentUrls(supabase, id);

  // Spec 265 U2 — the applicant's LINE ground-truth identity (anti-impersonation
  // verification at approval time). Read via the admin client scoped to the ONE
  // registration.user_id (a proc_mgr/PD approver can't read another user's row on
  // their RLS session — same exposure model as the doc signed-URL mint above).
  // Visible to all three approvers (STAFF_APPROVAL_ROLES already gates this page).
  const lineIdentity = await getLineIdentityByUserId(registration.user_id);

  // Spec 279 F2b — who invited this applicant (the SA whose per-project QR they
  // scanned). Advisory context only. Resolved via the admin-client name helper
  // (same exposure model as the LINE-identity block above — an approver can't read
  // another user's row on their own RLS session).
  const inviterName = registration.invited_by
    ? ((await fetchDisplayNames([registration.invited_by], "staff-registration-approval")).get(
        registration.invited_by,
      ) ?? null)
    : null;

  // RLS-scoped read (never admin) — mirrors /workers' project picker. Active
  // only: the operator's ask is "active projects", and an approver has no
  // reason to hand a new hire a completed/on-hold/archived site.
  const { data: projectRows } =
    registration.status === "pending"
      ? await supabase
          .from("projects")
          .select("id, code, name")
          .eq("status", "active")
          .order("code", { ascending: true })
      : { data: null };

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

        <LineIdentityBlock
          lineDisplayName={lineIdentity.lineDisplayName}
          lineAvatarUrl={lineIdentity.lineAvatarUrl}
          lineSyncedAt={lineIdentity.lineSyncedAt}
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
            {registration.invited_by ? (
              <Row label={REGISTRATION_INVITED_BY_LABEL} value={inviterName} />
            ) : null}
            {registration.status === "rejected" && registration.reject_reason ? (
              <Row label="เหตุผลที่ปฏิเสธ" value={registration.reject_reason} />
            ) : null}
          </dl>
        </div>

        <RegistrationDocumentsView urls={urls} />

        {registration.status === "pending" ? (
          <RegistrationDecision
            registrationId={registration.id}
            declaredRoleHint={registration.declared_role_hint}
            projects={projectRows ?? []}
            invitedProjectId={registration.invited_project_id}
          />
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
