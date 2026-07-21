// Spec 263 U3 — the approval queue's list rows. Server component (plain
// <Link> rows, no client state) — reused by both the back-office queue
// (/registrations, with an implicit "open to decide" affordance) and the SA
// read-only view (/sa/registrations, same rows, no decide affordance either
// way since the decision lives on the detail page, not the row).
//
// Doc-completeness hint (spec doc: "doc-completeness hint"): a badge showing
// N/3 docs uploaded, and whether the U1c approval floor (full_name + a live
// id_card) is met — the queue can flag an incomplete applicant before the
// reviewer opens the detail and hits the RPC's floor rejection.

import Link from "next/link";
import { CARD } from "@/lib/ui/classes";
import { registrationStatusBadge, type BadgeTone } from "@/lib/register/card-view";
import type { RegistrationQueueRow } from "@/lib/register/registration-queue-view";
import { formatThaiDateTime } from "@/lib/i18n/labels";

const BADGE_TONE_CLASSES: Record<BadgeTone, string> = {
  pending: "border-attn-edge bg-attn-soft text-attn-ink",
  approved: "border-done-edge bg-done-soft text-done-ink",
  rejected: "border-danger-edge bg-danger-soft text-danger-ink",
};

export function RegistrationQueueList({
  rows,
  detailHrefFor,
  emptyMessage,
}: {
  rows: readonly RegistrationQueueRow[];
  detailHrefFor: (id: string) => string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className={CARD}>
        <p className="text-ink-muted text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const badge = registrationStatusBadge(row.status);
        return (
          <li key={row.id}>
            <Link href={detailHrefFor(row.id)} className={`${CARD} block`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-40 flex-1">
                  <p className="text-ink text-base font-semibold break-words">{row.displayName}</p>
                  <p className="text-ink-secondary font-mono text-xs">{row.employeeId}</p>
                </div>
                <span
                  className={`text-meta ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${BADGE_TONE_CLASSES[badge.tone]}`}
                >
                  {badge.label}
                </span>
              </div>
              <div className="text-ink-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span>ส่งคำขอเมื่อ {formatThaiDateTime(row.createdAt)}</span>
                <span>
                  เอกสาร {row.docsUploadedCount}/{row.docsTotal}
                </span>
                {/* Spec 328 U3 — firm-invited applicant: which ทีมผู้รับเหมา QR
                    they came through (advisory; the approver confirms on the
                    detail). Neutral tone — it's context, not a state. */}
                {row.firmName ? (
                  <span className="border-edge bg-sunk text-ink-secondary inline-flex items-center rounded-full border px-2 py-0.5">
                    {row.firmName}
                  </span>
                ) : null}
                {/* Spec 333 — approved with deferred docs, still incomplete:
                    the chase-the-documents flag for HR. */}
                {row.docsOwed ? (
                  <span className="border-attn-edge bg-attn-soft text-attn-ink inline-flex items-center rounded-full border px-2 py-0.5 font-semibold">
                    เอกสารค้าง
                  </span>
                ) : null}
                {row.status === "pending" && row.hasReviewerNote ? (
                  <span className="border-attn-edge bg-attn-soft text-attn-ink inline-flex items-center rounded-full border px-2 py-0.5 font-semibold">
                    ส่งกลับแก้ไข
                  </span>
                ) : null}
                {row.status === "pending" && !row.meetsFloor ? (
                  <span className="text-danger font-semibold">ยังไม่ครบสำหรับอนุมัติ</span>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
