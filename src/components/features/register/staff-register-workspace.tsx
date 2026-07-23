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
import { OfficeInviteGate } from "@/components/features/register/office-invite-gate";
import { RegisterPrepGate } from "@/components/features/register/register-prep-gate";
import { ShareCardButton } from "@/components/features/register/share-card-button";
import { RegistrationPendingNotice } from "@/components/features/register/registration-pending-notice";
import { RegistrationReturnedNotice } from "@/components/features/register/registration-returned-notice";
import { DocsOwedCard } from "@/components/features/register/docs-owed-card";
import { deferredDocsOwed } from "@/lib/register/docs-owed";
import { approvalFloorFromLoaded } from "@/lib/register/registration-floor";
import { validateRegistrationBank } from "@/lib/register/registration-bank";
import {
  getOwnTechnicianRegistration,
  getOwnRegistrationDocuments,
  getOwnStaffConsent,
  getOwnStaffBank,
} from "@/lib/register/own-registration";
import {
  staffRegisterCopy,
  registerLoginNext,
  officeInviteParams,
  type RegisterVariant,
} from "@/lib/register/register-entry";
import { invitedRoleFromHint } from "@/lib/register/office-roles";
import { isValidUuid } from "@/lib/validate/uuid";
import {
  REGISTER_STATUS_HEADING,
  SUBCON_JOIN_PREFIX,
  SUBCON_REGISTER_BANNER_HINT,
} from "@/lib/i18n/labels";

export async function StaffRegisterWorkspace({
  variant,
  site,
  project,
  by,
  contractor,
  firm,
  role,
}: {
  variant: RegisterVariant;
  // Spec 279 F2a/F2b — the SA's per-project QR carries `?site=<label>` (display),
  // `?project=<id>` and `?by=<sa_uid>` (attribution). Only the on-site (field)
  // door forwards these; office doesn't get project/site/firm (office roles are
  // not project-scoped and get no workers row) — but spec 342 has the office
  // door forward `?by` + `?role` (see `role` below). `| undefined` is explicit
  // so a possibly-undefined searchParam is assignable under
  // exactOptionalPropertyTypes.
  site?: string | undefined;
  project?: string | undefined;
  by?: string | undefined;
  // Spec 328 — the per-firm subcon QR adds `?contractor=<id>` (advisory, uuid-gated
  // at the action + existence-coerced by the RPC) and `?firm=<label>` (display-only,
  // SA-minted, React-escaped — same trust class as `site`).
  contractor?: string | undefined;
  firm?: string | undefined;
  /** Spec 342 — the office invite's ?role key (advisory, D5). */
  role?: string | undefined;
}) {
  const copy = staffRegisterCopy(variant);
  const officeInvite = variant === "office" ? officeInviteParams({ by, role }) : null;
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  // Thread a return path so a logged-out visitor who taps this door comes BACK
  // here after LINE login instead of being stranded on /coming-soon (a fresh
  // account defaults to role `visitor`) — WITH the QR attribution params, or a
  // new subcon/project registrant loses their firm/project binding for good
  // (start_staff_registration is mint-once). /login re-validates the whole
  // value via safeNextPath.
  if (!data) redirect(registerLoginNext(variant, { project, site, by, contractor, firm, role }));
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
  // Spec 333 U2: EXCEPT a deferred-docs approval (documents_deferred_at, mig
  // 075822) that still owes documents — that renders the docs-owed view
  // instead; once nothing is owed the redirect behaves exactly as before.
  if (registration?.status === "approved") {
    const home = roleHome(userRow?.role ?? "technician");
    if (registration.documents_deferred_at !== null) {
      const [{ urls }, bank] = await Promise.all([
        getOwnRegistrationDocuments(supabase, registration.id),
        getOwnStaffBank(supabase),
      ]);
      const owed = deferredDocsOwed({
        status: registration.status,
        documentsDeferredAt: registration.documents_deferred_at,
        hasIdCard: Boolean(urls.id_card),
        hasBookBank: Boolean(urls.book_bank),
        hasBankFields: bank !== null,
      });
      if (owed.length > 0) {
        return (
          <PageShell>
            <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-10`}>
              <h1 className={SECTION_HEADING}>{REGISTER_STATUS_HEADING}</h1>
              <DocsOwedCard
                uid={uid}
                owed={owed}
                docUrls={urls}
                homeHref={home}
                initialBank={bank}
              />
            </section>
          </PageShell>
        );
      }
    }
    redirect(home);
  }

  // Spec 328 — subcon (bank-exempt) context. Fresh form: from the QR's advisory
  // ?contractor (uuid-shaped only). Once a registration exists, the TRUSTED source
  // is the row's invited_contractor_id (set existence-coerced by the RPC) — the
  // URL no longer matters.
  const contractorParam = contractor && isValidUuid(contractor) ? contractor : null;
  const subconFresh = !registration && contractorParam !== null;
  const subconPending = Boolean(registration?.invited_contractor_id);

  return (
    <PageShell>
      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-10`}>
        <h1 className={SECTION_HEADING}>{registration ? REGISTER_STATUS_HEADING : copy.heading}</h1>
        {site ? (
          <div className={`${CARD} border-action bg-action-soft`}>
            <p className="text-ink-secondary text-sm">สมัครเข้าโครงการ</p>
            <p className="text-ink mt-0.5 text-base font-semibold">{site}</p>
            <p className="text-ink-muted mt-1 text-xs">
              หากไม่ใช่โครงการที่ท่านทำงาน กรุณาสแกน QR ให้ถูกต้องก่อนสมัคร
            </p>
          </div>
        ) : null}
        {subconFresh || subconPending ? (
          <div className={`${CARD} border-action bg-action-soft`}>
            <p className="text-ink-secondary text-sm">{SUBCON_JOIN_PREFIX}</p>
            {subconFresh && firm ? (
              <p className="text-ink mt-0.5 text-base font-semibold">{firm}</p>
            ) : null}
            <p className="text-ink-muted mt-1 text-xs">{SUBCON_REGISTER_BANNER_HINT}</p>
          </div>
        ) : null}
        {!registration ? (
          variant === "office" && officeInvite === null ? (
            // Spec 342 D3 — no valid invite, no existing registration: the
            // organic office door is closed. Order matters: an applicant WITH a
            // registration never sees this gate (the status view wins below).
            <OfficeInviteGate />
          ) : (
            // Spec 343 U2 — the เตรียมตัว landing wraps the FRESH form: the
            // applicant sees what to bring, then taps into the same form (state,
            // not a route, so the QR params below are never re-threaded).
            <RegisterPrepGate bankExempt={subconFresh}>
              <StaffRegistrationForm
                registrationExists={false}
                uid={null}
                docUrls={{}}
                consentedAt={null}
                invitedBy={variant === "office" ? (officeInvite?.by ?? null) : (by ?? null)}
                invitedProjectId={project ?? null}
                invitedContractorId={contractorParam}
                bankExempt={subconFresh}
                invitedRole={officeInvite?.role ?? null}
                initial={{
                  fullName: "",
                  phone: "",
                  dob: "",
                  emergencyName: "",
                  emergencyRelation: "",
                  emergencyPhone: "",
                  declaredRoleHint: officeInvite?.role ?? "",
                  bankName: "",
                  accountNumber: "",
                  accountName: "",
                }}
              />
            </RegisterPrepGate>
          )
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

/** Exported for test only (spec 343 U1): it is an async component nested inside
 *  the parent's JSX, so RTL cannot resolve it through StaffRegisterWorkspace —
 *  the floor→notice seam has to be rendered directly to be pinned at all. */
export async function RegistrationWorkspace({
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

  // Spec 343 U1 — the approval floor, derived ONCE here from the data this
  // component already loaded, so the pending notice cannot claim the application
  // is submitted while the form below still shows outstanding requirements.
  const floor = approvalFloorFromLoaded({
    fullName: registration.full_name,
    docUrls: urls,
    consentedAt: consent?.consentedAt ?? null,
    // Mirrors the form's own rule: the floor counts PERSISTED bank fields, never
    // unsaved typed state (staff-registration-form.tsx `bankSaved`).
    bankSaved:
      validateRegistrationBank({
        bankName: bank?.bankName ?? "",
        accountNumber: bank?.accountNumber ?? "",
        accountName: bank?.accountName ?? "",
      }) === null,
    bankExempt: Boolean(registration.invited_contractor_id),
  });

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
        registration.reject_reason && registration.reject_reason.trim() ? (
          // Spec 322 — sent back for edit: reviewer note on reject_reason while
          // still pending. Show the "action needed" card instead of the generic
          // "sit tight" pending notice; the edit form below still renders.
          <RegistrationReturnedNotice note={registration.reject_reason} />
        ) : (
          <RegistrationPendingNotice employeeId={registration.employee_id} floor={floor} />
        )
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
          bankExempt={Boolean(registration.invited_contractor_id)}
          invitedRole={invitedRoleFromHint(registration.declared_role_hint)}
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
