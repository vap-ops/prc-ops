// Spec 263 U2 / spec 264 G1+G2 — the staff self-registration workspace. Reachable
// by a fresh `visitor` (NOT requireRole, which would bounce to /coming-soon) —
// mirrors /portal/claim's guard exactly (spec 130 U3): getClaims → redirect
// /login if no session; an already-registered-approved user (role=technician)
// or an approved registration is sent to their own home (roleHome). Otherwise
// render ONE consolidated form (StaffRegistrationForm, spec 264 G2): identity
// fields + document uploads + the PDPA consent checkbox together, whether or
// not a registration row exists yet.

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
} from "@/lib/register/own-registration";

export const metadata = { title: "สมัครเป็นช่าง" };

export default async function RegisterTechnicianPage({
  searchParams,
}: {
  // Spec 279 F2a — the SA's per-project QR carries `?site=<label>` (plus
  // `project`/`by`, read later by F2b). `site` is a display-only, untrusted label
  // (the SA minted the QR) shown so the applicant can confirm they scanned the
  // right project's code before registering. React escapes it as text content.
  searchParams: Promise<{ site?: string }>;
}) {
  const supabase = await createClient();
  const { site } = await searchParams;

  const { data } = await supabase.auth.getClaims();
  // spec 263 follow-up — thread a return path so a logged-out technician who
  // taps /register/technician comes BACK here after LINE login instead of being
  // stranded on /coming-soon (a fresh account defaults to role `visitor`). The
  // path is a hard-coded same-origin literal; /login re-validates it via
  // safeNextPath, so no open-redirect surface is introduced.
  if (!data) redirect("/login?next=%2Fregister%2Ftechnician");
  const uid = data.claims.sub;

  const { data: userRow } = await supabase
    .from("users")
    .select("role, line_avatar_url")
    .eq("id", uid)
    .maybeSingle();
  if (userRow?.role === "technician") redirect(roleHome(userRow.role));

  const registration = await getOwnTechnicianRegistration(supabase, uid);
  if (registration?.status === "approved") redirect(roleHome("technician"));

  return (
    <PageShell>
      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>สมัครเป็นช่าง</h1>
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
            initial={{
              fullName: "",
              phone: "",
              dob: "",
              emergencyName: "",
              emergencyRelation: "",
              emergencyPhone: "",
              declaredRoleHint: "",
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
  const [{ urls }, consent] = await Promise.all([
    getOwnRegistrationDocuments(supabase, registration.id),
    getOwnStaffConsent(supabase, registration.id),
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
          }}
        />
      ) : null}
    </>
  );
}
