// The ช่าง's money block: wage-payment history + bank account.
//
// Spec 376 U3 split this out of WorkerPortalSections onto /technician/history.
// Spec 388 U2 moved it BACK to หน้าหลัก and gave that route to attendance —
// because the ประวัติ tab had 0 route views all-time, and because
// /settings/my-info deliberately refuses to host a bound ช่าง's bank
// ("surfacing two bank homes for one person invites drift", 2026-07-14) and
// instead POINTS AT หน้าหลักช่าง. U3 had moved the bank off that page, leaving
// that pointer aimed at a page with no bank on it; returning it here makes the
// existing copy true rather than inventing a third surface.
//
// Two changes came with the move (spec 388 D4/D5):
//   * รายการรอรับ left this component — it is the ONLY write a ช่าง owns, so it
//     mounts high on หน้าหลัก, directly under the QR, not inside a money block;
//   * the wage list renders only when non-empty, because wage_payments is 0 rows
//     all-time and a permanent empty state is furniture on a daily page.
//
// Headings, classes and the bankExempt rule are unchanged from the original, so
// this and worker-portal-sections.tsx cannot drift in wording. Pure render — no
// I/O; the route fetches on the RLS server client, self-scoped by the
// workers.user_id binding. Server Component.

import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import { WAGE_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";
import { ProfileBankSection } from "@/components/features/profile/profile-bank-section";
import type { Database } from "@/lib/db/database.types";
import { bahtUnit as baht } from "@/lib/format";

type WorkerProfile = Database["public"]["Functions"]["get_my_worker_profile"]["Returns"][number];
type WagePayment = Database["public"]["Functions"]["get_my_wage_payments"]["Returns"][number];

export function WorkerHistorySections({
  uid,
  wp,
  payments,
  hasPendingBank,
  bankExempt = false,
}: {
  /** Spec 315 U2 — the bank-change form uploads to technician/<uid>/book_bank/. */
  uid: string;
  wp: WorkerProfile;
  payments: WagePayment[];
  hasPendingBank: boolean;
  /** Spec 328 U3 — contractor-tied (pay-exempt) member: PRC never pays them, so
   *  the bank section is hidden entirely (no display, no change form). */
  bankExempt?: boolean;
}) {
  const sortedPayments = [...payments].sort((a, b) => b.period_to.localeCompare(a.period_to));

  return (
    <>
      {/* Spec 388 U2 (D4): the wage list renders ONLY when there is something to
          show. wage_payments is 0 rows all-time — the spec-306 money wall holds
          every worker until cost-confirm — so an "ยังไม่มีประวัติการจ่ายเงิน"
          empty state would be permanent furniture on the page a ช่าง actually
          opens. It restores itself the day payroll produces a row. The operator
          scoped ประวัติ to attendance "for now"; this implements that literally,
          deleting nothing. */}
      {sortedPayments.length > 0 ? (
        <>
          <h2 className={SECTION_HEADING}>ประวัติการจ่ายเงิน</h2>
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
        </>
      ) : null}

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
