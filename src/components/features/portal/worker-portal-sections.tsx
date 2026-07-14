// Spec 266 U7 (option C) — the ช่าง's own portal content, hosted on /technician
// (a ช่าง logs in as `technician` and gets a dedicated home; the subcontractor
// /portal no longer carries the worker view). Extracted verbatim from the old
// /portal worker branch so the two surfaces don't drift. Pure render from loaded
// data — no I/O; the caller fetches on the RLS server client (self-scoped by the
// workers.user_id binding). Server Component (the interactive bits are the
// already-'use client' children).

import { EmptyNotice } from "@/components/features/common/notices";
import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import { WAGE_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";
import { WorkerProfileEdit } from "@/components/features/portal/worker-profile-edit";
import { WorkerConsents } from "@/components/features/portal/worker-consents";
import { WorkerBankChangeForm } from "@/components/features/portal/worker-bank-change-form";
import { PortalReceipts, type PortalReceipt } from "@/components/features/portal/portal-receipts";
import type { PortalConsent } from "@/components/features/portal/portal-self-edit";
import type { Database } from "@/lib/db/database.types";
import { bahtUnit as baht } from "@/lib/format";

type WorkerProfile = Database["public"]["Functions"]["get_my_worker_profile"]["Returns"][number];
type WagePayment = Database["public"]["Functions"]["get_my_wage_payments"]["Returns"][number];

export function WorkerPortalSections({
  uid,
  wp,
  payments,
  consents,
  receipts,
  hasPendingBank,
}: {
  /** Spec 315 U2 — the bank-change form uploads to technician/<uid>/book_bank/. */
  uid: string;
  wp: WorkerProfile;
  payments: WagePayment[];
  consents: PortalConsent[];
  receipts: PortalReceipt[];
  hasPendingBank: boolean;
}) {
  const sortedPayments = [...payments].sort((a, b) => b.period_to.localeCompare(a.period_to));

  return (
    <>
      {/* Spec 177 U8: items to confirm receipt — the actionable surface first. */}
      <h2 className={SECTION_HEADING}>รายการรอรับ</h2>
      <div className="mb-6">
        <PortalReceipts receipts={receipts} />
      </div>

      <h2 className={SECTION_HEADING}>ข้อมูลของฉัน</h2>
      <div className="mb-3">
        <WorkerProfileEdit
          initial={{
            phone: wp.phone ?? "",
            email: wp.email ?? "",
            emergencyName: wp.emergency_contact_name ?? "",
            emergencyRelation: wp.emergency_contact_relation ?? "",
            emergencyPhone: wp.emergency_contact_phone ?? "",
            dob: wp.date_of_birth ?? "",
          }}
        />
      </div>
      {/* tax_id is PM-entered from the ID card — read-only to the ช่าง. */}
      {wp.tax_id ? (
        <dl className={`${CARD} mb-6`}>
          <div className="flex justify-between gap-3 py-1">
            <dt className="text-ink-secondary text-sm">เลขผู้เสียภาษี</dt>
            <dd className="text-ink min-w-0 truncate text-sm font-medium">{wp.tax_id}</dd>
          </div>
        </dl>
      ) : (
        <div className="mb-6" />
      )}

      <h2 className={SECTION_HEADING}>ความยินยอม</h2>
      <div className="mb-6">
        <WorkerConsents consents={consents} />
      </div>

      {/* Bank — display + self-service staged change → PM approval (U4c-2, the
          ADR-0051 §6 anti-fraud gate). The PM may also enter/edit it on /workers. */}
      <h2 className={SECTION_HEADING}>บัญชีธนาคาร</h2>
      {wp.bank_name || wp.bank_account_number || wp.bank_account_name ? (
        <div className={`${CARD} mb-3`}>
          <p className="text-ink text-sm font-medium">{wp.bank_name}</p>
          <p className="text-ink text-sm">
            {wp.bank_account_number}
            {wp.bank_account_name ? ` · ${wp.bank_account_name}` : ""}
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <EmptyNotice>ยังไม่มีบัญชีธนาคาร</EmptyNotice>
        </div>
      )}
      <div className="mb-6">
        <WorkerBankChangeForm uid={uid} hasPending={hasPendingBank} />
      </div>

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
                จ่ายเมื่อ {formatThaiDate(p.paid_at)} · {WAGE_PAYMENT_METHOD_LABELS[p.method]}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNotice>ยังไม่มีประวัติการจ่ายเงิน</EmptyNotice>
      )}
    </>
  );
}
