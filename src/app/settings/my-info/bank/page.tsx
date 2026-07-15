// Spec 319 U2 — /settings/my-info/bank: the login-keyed bank EDIT page. The edit
// lives on its own route, never inline on the /settings/my-info detail page
// (operator rule 2026-07-15). Shown to the admin/office tier that has no
// worker/contractor/registration bank home; the submit RPC re-gates the
// single-home rule, so this page composes the form + current-bank context only.
//
// Auth mirrors /settings/my-info (getClaims, NOT requireRole — an unserved role
// must not be bounced to roleHome). Reads on the RLS session client.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { UserBankChangeForm } from "@/components/features/profile/user-bank-change-form";
import { getOwnUserBank } from "@/lib/register/own-user-bank";
import { isEmployeeRole } from "@/lib/auth/role-home";

export const metadata = { title: "แก้ไขบัญชีธนาคาร" };

export default async function MyInfoBankPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData) {
    redirect("/login");
  }
  const uid = claimsData.claims.sub;

  // Gate the route to the same audience the /settings/my-info link is shown to
  // (fresh-eyes 2026-07-15): a worker / contractor / approved-staff / non-employee
  // login whose real bank home is elsewhere is redirected rather than shown a
  // dead-end form the submit RPC would only refuse. Mirrors isUserBankHome.
  const [{ data: userRow }, { data: workerId }, { data: contractorId }, { data: approvedReg }] =
    await Promise.all([
      supabase.from("users").select("role").eq("id", uid).maybeSingle(),
      supabase.rpc("current_user_worker_id"),
      supabase.rpc("current_user_contractor_id"),
      supabase
        .from("staff_registrations")
        .select("id")
        .eq("user_id", uid)
        .eq("status", "approved")
        .limit(1),
    ]);
  const isUserBankHome =
    !!userRow &&
    isEmployeeRole(userRow.role) &&
    !workerId &&
    !contractorId &&
    (approvedReg?.length ?? 0) === 0;
  if (!isUserBankHome) {
    redirect("/settings/my-info");
  }

  const [currentBank, { data: pending }] = await Promise.all([
    getOwnUserBank(supabase),
    supabase
      .from("user_bank_change_requests")
      .select("id")
      .eq("user_id", uid)
      .eq("status", "pending")
      .limit(1),
  ]);

  return (
    <PageShell>
      <DetailHeader backHref="/settings/my-info" backLabel="กลับไปข้อมูลของฉัน">
        <h1 className="text-ink text-xl font-semibold tracking-tight">แก้ไขบัญชีธนาคาร</h1>
      </DetailHeader>

      <section className={`mx-auto flex flex-col gap-4 ${PAGE_MAX_W} px-5 py-6`}>
        {currentBank ? (
          <>
            <h2 className={SECTION_HEADING}>บัญชีปัจจุบัน</h2>
            <div className={CARD}>
              <p className="text-ink text-sm font-medium">{currentBank.bankName}</p>
              <p className="text-ink text-sm">
                {currentBank.accountNumber}
                {currentBank.accountName ? ` · ${currentBank.accountName}` : ""}
              </p>
            </div>
          </>
        ) : null}

        <UserBankChangeForm uid={uid} hasPending={(pending?.length ?? 0) > 0} />
      </section>
    </PageShell>
  );
}
