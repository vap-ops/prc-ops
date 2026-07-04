// Spec 263 U2 / ADR 0061 — the technician self-registration workspace. Reachable
// by a fresh `visitor` (NOT requireRole, which would bounce to /coming-soon) —
// mirrors /portal/claim's guard exactly (spec 130 U3): getClaims → redirect
// /login if no session; an already-registered-approved user (role=technician)
// or an approved registration is sent to their own home (roleHome). Otherwise
// render the START form (no registration yet) or the pending workspace
// (e-employee card + progressive form + document uploads + Web Share).

import { redirect } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { createClient } from "@/lib/db/server";
import { roleHome } from "@/lib/auth/role-home";
import { StartRegistrationForm } from "@/components/features/register/start-registration-form";
import { EmployeeCard } from "@/components/features/register/employee-card";
import { RegistrationForm } from "@/components/features/register/registration-form";
import { RegistrationDocuments } from "@/components/features/register/registration-documents";
import { ShareCardButton } from "@/components/features/register/share-card-button";
import {
  getOwnTechnicianRegistration,
  getOwnRegistrationDocuments,
} from "@/lib/register/own-registration";

export const metadata = { title: "สมัครเป็นช่าง" };

export default async function RegisterTechnicianPage() {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  // spec 263 follow-up — thread a return path so a logged-out technician who
  // taps /register/technician comes BACK here after LINE login instead of being
  // stranded on /coming-soon (a fresh account defaults to role `visitor`). The
  // path is a hard-coded same-origin literal; /login re-validates it via
  // safeNextPath, so no open-redirect surface is introduced.
  if (!data) redirect("/login?next=%2Fregister%2Ftechnician");
  const uid = data.claims.sub;

  const { data: userRow } = await supabase.from("users").select("role").eq("id", uid).maybeSingle();
  if (userRow?.role === "technician") redirect(roleHome(userRow.role));

  const registration = await getOwnTechnicianRegistration(supabase, uid);
  if (registration?.status === "approved") redirect(roleHome("technician"));

  return (
    <PageShell>
      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>สมัครเป็นช่าง</h1>
        {!registration ? (
          <StartRegistrationForm />
        ) : (
          <RegistrationWorkspace uid={uid} registration={registration} />
        )}
      </section>
    </PageShell>
  );
}

async function RegistrationWorkspace({
  uid,
  registration,
}: {
  uid: string;
  registration: NonNullable<Awaited<ReturnType<typeof getOwnTechnicianRegistration>>>;
}) {
  const supabase = await createClient();
  const { urls } = await getOwnRegistrationDocuments(supabase, registration.id);

  return (
    <>
      <EmployeeCard
        employeeId={registration.employee_id}
        fullName={registration.full_name}
        status={registration.status}
        photoUrl={urls.profile_photo ?? null}
      />
      {registration.status === "rejected" && registration.reject_reason ? (
        <div className={`${CARD} border-danger-edge bg-danger-soft`}>
          <p className="text-danger-ink text-sm font-semibold">ใบสมัครถูกปฏิเสธ</p>
          <p className="text-danger-ink mt-1 text-sm">{registration.reject_reason}</p>
        </div>
      ) : null}
      <ShareCardButton
        employeeId={registration.employee_id}
        fullName={registration.full_name ?? ""}
      />
      {registration.status === "pending" ? (
        <>
          <RegistrationForm
            initial={{
              fullName: registration.full_name ?? "",
              phone: registration.phone ?? "",
              dob: registration.date_of_birth ?? "",
              emergencyName: registration.emergency_contact_name ?? "",
              emergencyRelation: registration.emergency_contact_relation ?? "",
              emergencyPhone: registration.emergency_contact_phone ?? "",
            }}
          />
          <RegistrationDocuments uid={uid} urls={urls} />
        </>
      ) : null}
    </>
  );
}
