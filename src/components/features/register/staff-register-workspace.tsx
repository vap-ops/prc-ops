// Spec 263 U2 / spec 264 G1+G2 — the staff self-registration workspace. Reachable
// by a fresh `visitor` (NOT requireRole, which would bounce to /coming-soon) —
// mirrors /portal/claim's guard exactly (spec 130 U3): getClaims → redirect
// /login if no session; an already-registered-approved user or an approved
// registration is sent to their own home (roleHome). Otherwise render ONE
// consolidated form (StaffRegistrationForm, spec 264 G2): identity fields +
// document uploads + the PDPA consent checkbox together.
//
// Spec 286 U1 — extracted from /register/technician and parameterized by
// `variant` ("field" | "office"). The form, documents, queue, and approval RPC
// are all role-neutral (spec 263/264); the variant drives ONLY the fresh-form
// heading + the logged-out return path. Once a registration exists (the
// pending/rejected view every registered visitor is redirected into via
// REGISTER_WORKSPACE_PATH, regardless of door) the heading is the neutral
// REGISTER_STATUS_HEADING — so an office applicant never re-reads "สมัครเป็นช่าง".

import { redirect } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { createClient } from "@/lib/db/server";
import { roleHome } from "@/lib/auth/role-home";
import { EmployeeCard } from "@/components/features/register/employee-card";
import { resolveCardPhoto } from "@/lib/register/card-view";
import { StaffRegistrationForm } from "@/components/features/register/staff-registration-form";
import { ShareCardButton } from "@/components/features/register/share-card-button";
import { RegistrationPendingNotice } from "@/components/features/register/registration-pending-notice";
import {
  getOwnTechnicianRegistration,
  getOwnRegistrationDocuments,
  getOwnStaffConsent,
  getOwnStaffBank,
} from "@/lib/register/own-registration";
import { staffRegisterCopy, type RegisterVariant } from "@/lib/register/register-entry";
import { REGISTER_STATUS_HEADING } from "@/lib/i18n/labels";

export async function StaffRegisterWorkspace({
  variant,
  site,
  project,
  by,
}: {
  variant: RegisterVariant;
  // Spec 279 F2a/F2b — the SA's per-project QR carries `?site=<label>` (display),
  // `?project=<id>` and `?by=<sa_uid>` (attribution). Only the on-site (field)
  // door forwards these; the office door omits them (office roles are not
  // project-scoped and get no workers row). `| undefined` is explicit so a
  // possibly-undefined searchParam is assignable under exactOptionalPropertyTypes.
  site?: string | undefined;
  project?: string | undefined;
  by?: string | undefined;
}) {
  const copy = staffRegisterCopy(variant);
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  // Thread a return path so a logged-out visitor who taps this door comes BACK
  // here after LINE login instead of being stranded on /coming-soon (a fresh
  // account defaults to role `visitor`). /login re-validates via safeNextPath.
  if (!data) redirect(copy.loginNext);
  const uid = data.claims.sub;

  const { data: userRow } = await supabase
    .from("users")
    .select("role, line_avatar_url")
    .eq("id", uid)
    .maybeSingle();
  if (userRow?.role === "technician") redirect(roleHome(userRow.role));

  const registration = await getOwnTechnicianRegistration(supabase, uid);
  // Approved → their real home (roleHome of the assigned role, not hard-coded
  // technician — an approved office hire has an office role by now).
  if (registration?.status === "approved") redirect(roleHome(userRow?.role ?? "technician"));

  return (
    <PageShell>
      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>{registration ? REGISTER_STATUS_HEADING : copy.heading}</h1>
        {site ? (
          <div className={`${CARD} border-action-edge bg-action-soft`}>
            <p className="text-ink-secondary text-sm">สมัครเข้าโครงการ</p>
            <p className="text-ink mt-0.5 text-base font-semibold">{site}</p>
            <p className="text-ink-muted mt-1 text-xs">
              หากไม่ใช่โครงการที่ท่านทำงาน กรุณาสแกน QR ให้ถูกต้องก่อนสมัคร
            </p>
          </div>
        ) : null}
        {!registration ? (
          <StaffRegistrationForm
            registrationExists={false}
            uid={null}
            docUrls={{}}
            consentedAt={null}
            invitedBy={by ?? null}
            invitedProjectId={project ?? null}
            initial={{
              fullName: "",
              phone: "",
              dob: "",
              emergencyName: "",
              emergencyRelation: "",
              emergencyPhone: "",
              declaredRoleHint: "",
              bankName: "",
              accountNumber: "",
              accountName: "",
            }}
          />
        ) : (
          <RegistrationWorkspace
            uid={uid}
            registration={registration}
            lineAvatarUrl={userRow?.line_avatar_url ?? null}
          />
        )}
      </section>
    </PageShell>
  );
}

async function RegistrationWorkspace({
  uid,
  registration,
  lineAvatarUrl,
}: {
  uid: string;
  registration: NonNullable<Awaited<ReturnType<typeof getOwnTechnicianRegistration>>>;
  lineAvatarUrl: string | null;
}) {
  const supabase = await createClient();
  const [{ urls }, consent, bank] = await Promise.all([
    getOwnRegistrationDocuments(supabase, registration.id),
    getOwnStaffConsent(supabase, registration.id),
    getOwnStaffBank(supabase),
  ]);

  return (
    <>
      <EmployeeCard
        employeeId={registration.employee_id}
        fullName={registration.full_name}
        status={registration.status}
        photoUrl={resolveCardPhoto(urls.profile_photo ?? null, lineAvatarUrl)}
      />
      {registration.status === "rejected" && registration.reject_reason ? (
        <div className={`${CARD} border-danger-edge bg-danger-soft`}>
          <p className="text-danger-ink text-sm font-semibold">ใบสมัครถูกปฏิเสธ</p>
          <p className="text-danger-ink mt-1 text-sm">{registration.reject_reason}</p>
        </div>
      ) : null}
      {registration.status === "pending" ? (
        <RegistrationPendingNotice employeeId={registration.employee_id} />
      ) : null}
      <ShareCardButton
        employeeId={registration.employee_id}
        fullName={registration.full_name ?? ""}
      />
      {registration.status === "pending" ? (
        <StaffRegistrationForm
          registrationExists
          uid={uid}
          docUrls={urls}
          consentedAt={consent?.consentedAt ?? null}
          initial={{
            fullName: registration.full_name ?? "",
            phone: registration.phone ?? "",
            dob: registration.date_of_birth ?? "",
            emergencyName: registration.emergency_contact_name ?? "",
            emergencyRelation: registration.emergency_contact_relation ?? "",
            emergencyPhone: registration.emergency_contact_phone ?? "",
            declaredRoleHint: registration.declared_role_hint ?? "",
            bankName: bank?.bankName ?? "",
            accountNumber: bank?.accountNumber ?? "",
            accountName: bank?.accountName ?? "",
          }}
        />
      ) : null}
    </>
  );
}
