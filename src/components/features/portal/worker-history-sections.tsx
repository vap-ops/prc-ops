// Spec 376 U3 (D3) — the MONEY half of the ช่าง's portal, split out of
// WorkerPortalSections onto its own ประวัติ route (/technician/history) when the
// technician got a bottom tab bar. One long scroll page became two tabbed
// surfaces: หน้าหลัก keeps the daily artifacts + identity, ประวัติ carries the
// record of money — รายการรอรับ (the actionable receipts first, spec 177 U8),
// then the wage-payment history, then the bank account.
//
// Sections moved VERBATIM from worker-portal-sections.tsx (headings, classes and
// the bankExempt rule unchanged) so the two surfaces cannot drift in wording. Pure
// render from loaded data — no I/O; the route fetches on the RLS server client,
// self-scoped by the workers.user_id binding. Server Component (the interactive
// bits are the already-'use client' children).

import { EmptyNotice } from "@/components/features/common/notices";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import { WAGE_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";
import { ProfileBankSection } from "@/components/features/profile/profile-bank-section";
import { PortalReceipts, type PortalReceipt } from "@/components/features/portal/portal-receipts";
import type { Database } from "@/lib/db/database.types";
import { bahtUnit as baht } from "@/lib/format";

type WorkerProfile = Database["public"]["Functions"]["get_my_worker_profile"]["Returns"][number];
type WagePayment = Database["public"]["Functions"]["get_my_wage_payments"]["Returns"][number];

export function WorkerHistorySections({
  uid,
  wp,
  payments,
  receipts,
  hasPendingBank,
  bankExempt = false,
}: {
  /** Spec 315 U2 — the bank-change form uploads to technician/<uid>/book_bank/. */
  uid: string;
  wp: WorkerProfile;
  payments: WagePayment[];
  receipts: PortalReceipt[];
  hasPendingBank: boolean;
  /** Spec 328 U3 — contractor-tied (pay-exempt) member: PRC never pays them, so
   *  the bank section is hidden entirely (no display, no change form). */
  bankExempt?: boolean;
}) {
  const sortedPayments = [...payments].sort((a, b) => b.period_to.localeCompare(a.period_to));

  return (
    <>
      {/* Spec 177 U8: items to confirm receipt — the actionable surface first. */}
      <h2 className={SECTION_HEADING}>รายการรอรับ</h2>
      <div className="mb-6">
        <PortalReceipts receipts={receipts} />
      </div>

      <h2 className={SECTION_HEADING}>ประวัติการจ่ายเงิน</h2>
      {sortedPayments.length > 0 ? (
        <ul className="mb-6 flex flex-col gap-3">
          {sortedPayments.map((p) => (
            <li key={p.id} className={CARD}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-ink-secondary text-xs">
                  {formatThaiDate(p.period_from)} – {formatThaiDate(p.period_to)}
                </p>
                <p className="text-ink shrink-0 text-sm font-bold">{baht(p.paid_amount ?? 0)}</p>
              </div>
              <p className="text-ink-secondary mt-1 text-xs">
                จ่ายเมื่อ {formatThaiDate(p.paid_at)} · {WAGE_PAYMENT_METHOD_LABELS[p.method]}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mb-6">
          <EmptyNotice>ยังไม่มีประวัติการจ่ายเงิน</EmptyNotice>
        </div>
      )}

      {/* Bank — display + self-service staged change → PM approval (U4c-2, the
          ADR-0051 §6 anti-fraud gate). The PM may also enter/edit it on /workers.
          Spec 328 U3: hidden entirely for a contractor-tied member (pay-exempt —
          the firm pays them, PRC holds no bank for them). */}
      {bankExempt ? null : (
        <>
          <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
          <div className="mb-6">
            <ProfileBankSection
              audience="worker"
              ownerId={uid}
              current={
                wp.bank_name || wp.bank_account_number || wp.bank_account_name
                  ? {
                      bankName: wp.bank_name ?? "",
                      accountNo: wp.bank_account_number ?? "",
                      accountName: wp.bank_account_name ?? "",
                    }
                  : null
              }
              showEmptyState
              hasPending={hasPendingBank}
            />
          </div>
        </>
      )}
    </>
  );
}
