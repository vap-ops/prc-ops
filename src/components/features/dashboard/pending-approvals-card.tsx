// Spec 183 U1 — the ภาพรวม รอตรวจ hero card. Presentational (no data fetch):
// takes the summary and surfaces the pending-approval count + oldest-waiting
// WP, linking into the /review queue. Pending uses the attention palette
// (amber); an empty queue renders calm — muted, no alarm — but stays a link so
// the PM can still reach the queue / its history.

import Link from "next/link";
import { ClipboardCheck, ArrowRight, Clock } from "lucide-react";
import {
  formatThaiDateTime,
  REVIEW_ACTIONABLE_EMPTY,
  REVIEW_ACTIONABLE_ZONE_LABEL,
  REVIEW_AWAITING_SITE_SHORT,
} from "@/lib/i18n/labels";
import type { PendingApprovalsSummary } from "@/lib/approvals/pending-summary";

export function PendingApprovalsCard({ summary }: { summary: PendingApprovalsSummary }) {
  const { count, awaitingSite, oldest } = summary;

  // Spec 371 U2 — the second figure. Never folded into `count`: an un-cured
  // bounce is the site admin's move, and blending the two is what made the old
  // single number misleading.
  const awaitingLine =
    awaitingSite > 0 ? (
      <span className="text-ink-secondary text-meta">
        {REVIEW_AWAITING_SITE_SHORT} {awaitingSite}
      </span>
    ) : null;

  if (count === 0) {
    return (
      <Link
        href="/review"
        className="border-edge bg-card shadow-card rounded-card hover:bg-sunk focus-visible:ring-action flex items-center justify-between gap-3 border p-4 transition-colors focus:outline-none focus-visible:ring-2"
      >
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <ClipboardCheck aria-hidden className="text-ink-muted size-5" />
            {/* "ไม่มีงานรอตรวจ" is only true when the queue is EMPTY. With work
                still sitting with the site those WPs are pending_approval and ARE
                listed on /review — just none of them the PM's move — so the card
                borrows /review's string for exactly this state. Same defect class
                as the งานรออนุมัติ label below: a sentence that stayed literally
                true of the rows the new number excludes. */}
            <span className="text-ink-secondary text-body">
              {awaitingSite > 0 ? REVIEW_ACTIONABLE_EMPTY : "ไม่มีงานรอตรวจ"}
            </span>
          </span>
          {awaitingLine}
        </span>
        <ArrowRight aria-hidden className="text-ink-muted size-5" />
      </Link>
    );
  }

  return (
    <Link
      href="/review"
      aria-label={
        awaitingSite > 0
          ? `รอตรวจ ${count} ${REVIEW_ACTIONABLE_ZONE_LABEL}, ${REVIEW_AWAITING_SITE_SHORT} ${awaitingSite}`
          : `รอตรวจ ${count} ${REVIEW_ACTIONABLE_ZONE_LABEL}`
      }
      className="border-attn-edge bg-attn-soft shadow-card rounded-card hover:border-attn focus-visible:ring-action flex flex-col gap-2 border p-4 transition-colors focus:outline-none focus-visible:ring-2"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <ClipboardCheck aria-hidden className="text-attn-ink size-5" />
          <span className="text-attn-ink text-body font-semibold">รอตรวจ</span>
        </span>
        <ArrowRight aria-hidden className="text-attn-ink size-5" />
      </div>

      {/* Spec 371 U2: the headline is the ACTIONABLE count, so it is labelled
          ตรวจได้ตอนนี้ (matching /review's zone A) — not the old งานรออนุมัติ,
          which is equally true of the awaiting rows this number now excludes. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-attn-ink text-3xl leading-none font-bold">{count}</span>
        <span className="text-attn-ink text-body">{REVIEW_ACTIONABLE_ZONE_LABEL}</span>
        {awaitingLine}
      </div>

      {oldest ? (
        <p className="text-attn-ink text-meta flex items-center gap-1">
          <Clock aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            เก่าสุด {oldest.projectCode ? `${oldest.projectCode} · ` : ""}
            <span className="font-mono">{oldest.wpCode}</span> · เข้าคิวเมื่อ{" "}
            {formatThaiDateTime(oldest.waitingSince)}
          </span>
        </p>
      ) : null}
    </Link>
  );
}
