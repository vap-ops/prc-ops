// Spec 317 U2 — /settings/my-info: the ONE self-service door every role gets
// (operator directive 2026-07-14; enterprise two-tier: instant vs approved).
//
// Composition rule — render what has no home elsewhere, link to the audience
// home for the rest (duplicating three portals here would drift):
//   - EVERY login: display name (instant) + identity-change request (approved
//     tier: name / national ID / DOB → the staff-approval trio) + its pending
//     banner.
//   - Office staff (approved registration, NO bound worker): this page IS their
//     home — contact form (instant, coalesce-keep), ID-card renewal (spec 315),
//     bank display + staged bank change with passbook (spec 317 U4).
//   - Bound workers (ช่าง): link card → /technician (their full portal).
//   - Contractors: link card → /portal.
//
// Auth mirrors /profile (getClaims, NOT requireRole — requireRole would bounce
// unserved roles to roleHome). All reads on the RLS session client.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { DisplayNameForm } from "@/components/features/common/display-name-form";
import { IdentityChangeForm } from "@/components/features/profile/identity-change-form";
import { StaffContactForm } from "@/components/features/profile/staff-contact-form";
import { StaffBankChangeForm } from "@/components/features/profile/staff-bank-change-form";
import { WorkerIdCardUpdate } from "@/components/features/portal/worker-id-card-update";
import {
  getOwnTechnicianRegistration,
  getOwnRegistrationDocuments,
  getOwnStaffBank,
} from "@/lib/register/own-registration";

export const metadata = { title: "ข้อมูลของฉัน" };

export default async function MyInfoPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) {
    redirect("/login");
  }
  const uid = claimsData.claims.sub;

  const { data: userRow } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", uid)
    .maybeSingle();
  if (!userRow) {
    redirect("/login");
  }

  const [{ data: workerId }, { data: contractorId }, registration, { data: identityPending }] =
    await Promise.all([
      supabase.rpc("current_user_worker_id"),
      supabase.rpc("current_user_contractor_id"),
      getOwnTechnicianRegistration(supabase, uid),
      supabase
        .from("identity_change_requests")
        .select("id")
        .eq("user_id", uid)
        .eq("status", "pending")
        .limit(1),
    ]);

  // Office staff = approved registration and NOT a bound worker (a bound ช่าง's
  // home is /technician; the staff bank RPC refuses bound workers anyway).
  const isStaffHome = Boolean(registration && registration.status === "approved" && !workerId);

  const [{ urls }, staffBank, { data: staffBankPending }] = isStaffHome
    ? await Promise.all([
        getOwnRegistrationDocuments(supabase, registration!.id),
        getOwnStaffBank(supabase),
        supabase
          .from("staff_bank_change_requests")
          .select("id")
          .eq("registration_id", registration!.id)
          .eq("status", "pending")
          .limit(1),
      ])
    : [{ urls: {} as Record<string, never> }, null, { data: [] }];

  return (
    <PageShell>
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-xl font-semibold tracking-tight">ข้อมูลของฉัน</h1>
      </DetailHeader>

      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-6`}>
        {/* Instant tier — the display name everyone can set (spec 07). */}
        <DisplayNameForm initialName={userRow.full_name ?? ""} />

        {/* Audience homes — a bound ช่าง / contractor manages contact + bank on
            their own portal; this page links instead of duplicating the forms. */}
        {workerId ? (
          <div className={CARD}>
            <p className="text-ink text-sm font-semibold">ข้อมูลช่างและบัญชีธนาคาร</p>
            <p className="text-ink-secondary mt-1 text-sm">
              แก้ไขข้อมูลติดต่อ เอกสาร และบัญชีธนาคารได้ที่{" "}
              <Link href="/technician" className="text-action underline">
                หน้าหลักช่าง
              </Link>
            </p>
          </div>
        ) : null}
        {!workerId && contractorId ? (
          <div className={CARD}>
            <p className="text-ink text-sm font-semibold">ข้อมูลผู้รับเหมาและบัญชีธนาคาร</p>
            <p className="text-ink-secondary mt-1 text-sm">
              แก้ไขข้อมูลติดต่อ เอกสาร และบัญชีธนาคารได้ที่{" "}
              <Link href="/portal" className="text-action underline">
                พอร์ทัลผู้รับเหมา
              </Link>
            </p>
          </div>
        ) : null}

        {/* Office staff — this page IS their self-service home (spec 317 U1/U4). */}
        {isStaffHome && registration ? (
          <>
            <h2 className={SECTION_HEADING}>ข้อมูลติดต่อ</h2>
            <StaffContactForm
              initial={{
                phone: registration.phone ?? "",
                emergencyName: registration.emergency_contact_name ?? "",
                emergencyRelation: registration.emergency_contact_relation ?? "",
                emergencyPhone: registration.emergency_contact_phone ?? "",
              }}
            />

            <h2 className={SECTION_HEADING}>เอกสาร</h2>
            <WorkerIdCardUpdate uid={uid} currentUrl={urls.id_card ?? null} />

            <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
            {staffBank ? (
              <div className={CARD}>
                <p className="text-ink text-sm font-medium">{staffBank.bankName}</p>
                <p className="text-ink text-sm">
                  {staffBank.accountNumber}
                  {staffBank.accountName ? ` · ${staffBank.accountName}` : ""}
                </p>
              </div>
            ) : null}
            <StaffBankChangeForm uid={uid} hasPending={(staffBankPending?.length ?? 0) > 0} />
          </>
        ) : null}

        {/* Approved tier — identity fields route through the trio (spec 317 U3). */}
        <h2 className={SECTION_HEADING}>ข้อมูลตัวตน</h2>
        <IdentityChangeForm hasPending={(identityPending?.length ?? 0) > 0} />
      </section>
    </PageShell>
  );
}
