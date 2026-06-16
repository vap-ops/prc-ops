// Spec 130 U3 / ADR 0051 — the DC self-service portal landing. External
// `contractor` tier only: requireRole(["contractor"]) is the boundary (a
// staffer lands here → roleHome bounces them to their own home; a visitor →
// /coming-soon). Reads go through the RLS-respecting server client — NOT the
// admin client — so the DB row-level policies (U2) are the enforcement: this
// session can only ever see its own contractor, crew, and payments. Money
// (amounts) comes from get_my_dc_payments(); rate columns are never selected
// (column-grant-blocked anyway).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LogoutButton } from "@/components/auth/logout-button";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import { DC_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";
import { BankChangeForm } from "@/components/features/portal/bank-change-form";
import { PortalSelfEdit, type PortalConsent } from "@/components/features/portal/portal-self-edit";

export const metadata = { title: "พอร์ทัลผู้รับเหมา" };

function baht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

export default async function PortalPage() {
  await requireRole(["contractor"]);
  const supabase = await createClient();

  // RLS scopes every read to the caller's own contractor (U2 policies).
  const { data: profile } = await supabase
    .from("contractors")
    .select(
      "id, name, phone, tax_id, contact_person, email, mailing_address, specialty, emergency_contact_name, emergency_contact_relation, emergency_contact_phone, date_of_birth",
    )
    .maybeSingle();
  const { data: consentRows } = await supabase
    .from("contractor_consents")
    .select("kind, consented_at, revoked_at")
    .order("created_at", { ascending: false });
  const { data: crew } = await supabase.from("workers").select("id, name, active").order("name");
  const { data: payments } = await supabase.rpc("get_my_dc_payments");
  const { data: pendingChange } = await supabase
    .from("contractor_bank_change_requests")
    .select("id")
    .eq("status", "pending")
    .maybeSingle();

  const sortedPayments = [...(payments ?? [])].sort((a, b) =>
    b.period_to.localeCompare(a.period_to),
  );

  const detail = (label: string, value: string | null | undefined) =>
    value ? (
      <div className="flex justify-between gap-3 py-1">
        <dt className="text-ink-secondary text-sm">{label}</dt>
        <dd className="text-ink min-w-0 truncate text-sm font-medium">{value}</dd>
      </div>
    ) : null;

  return (
    <PageShell>
      <header className="border-edge bg-card sticky top-0 z-20 border-b px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} items-center justify-between gap-3`}>
          <h1 className="text-title text-ink min-w-0 truncate font-bold tracking-tight">
            {profile?.name ?? "พอร์ทัลผู้รับเหมา"}
          </h1>
          <LogoutButton />
        </div>
      </header>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {/* Profile */}
        <h2 className={SECTION_HEADING}>ข้อมูลของฉัน</h2>
        <dl className={`${CARD} mb-6`}>
          {detail("ผู้ติดต่อ", profile?.contact_person)}
          {detail("โทร", profile?.phone)}
          {detail("อีเมล", profile?.email)}
          {detail("เลขผู้เสียภาษี", profile?.tax_id)}
          {detail("ที่อยู่", profile?.mailing_address)}
          {detail("งานที่ถนัด", profile?.specialty)}
        </dl>

        {/* Self-service: emergency contact + PDPA/background-check consent */}
        {profile?.id ? (
          <PortalSelfEdit
            contractorId={profile.id}
            ec={{
              name: profile.emergency_contact_name ?? "",
              relation: profile.emergency_contact_relation ?? "",
              phone: profile.emergency_contact_phone ?? "",
              dob: profile.date_of_birth ?? "",
            }}
            consents={(consentRows ?? []) as PortalConsent[]}
          />
        ) : null}

        {/* Bank — self-service change request (staged → PM approval) */}
        <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
        <div className="mb-6">
          <BankChangeForm hasPending={!!pendingChange} />
        </div>

        {/* Crew */}
        <h2 className={SECTION_HEADING}>ทีมช่าง</h2>
        {crew && crew.length > 0 ? (
          <ul className={`${CARD} divide-edge mb-6 flex flex-col divide-y`}>
            {crew.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink min-w-0 truncate text-sm font-medium">{w.name}</span>
                {!w.active ? (
                  <span className="text-ink-muted shrink-0 text-xs">ปิดใช้งาน</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mb-6">
            <EmptyNotice>ยังไม่มีรายชื่อทีมช่าง</EmptyNotice>
          </div>
        )}

        {/* Payment history */}
        <h2 className={SECTION_HEADING}>ประวัติการจ่ายเงิน</h2>
        {sortedPayments.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {sortedPayments.map((p) => (
              <li key={p.id} className={CARD}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-ink-secondary text-xs">
                    {formatThaiDate(p.period_from)} – {formatThaiDate(p.period_to)}
                  </p>
                  <p className="text-ink shrink-0 text-sm font-bold">{baht(p.paid_amount ?? 0)}</p>
                </div>
                <p className="text-ink-secondary mt-1 text-xs">
                  จ่ายเมื่อ {formatThaiDate(p.paid_at)} · {DC_PAYMENT_METHOD_LABELS[p.method]}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNotice>ยังไม่มีประวัติการจ่ายเงิน</EmptyNotice>
        )}
      </section>
    </PageShell>
  );
}
