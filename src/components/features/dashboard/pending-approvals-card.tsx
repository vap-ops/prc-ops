// Spec 183 U1 — the ภาพรวม รอตรวจ hero card. Presentational (no data fetch):
// takes the summary and surfaces the pending-approval count + oldest-waiting
// WP, linking into the /review queue. Pending uses the attention palette
// (amber); an empty queue renders calm — muted, no alarm — but stays a link so
// the PM can still reach the queue / its history.

import Link from "next/link";
import { ClipboardCheck, ArrowRight, Clock } from "lucide-react";
import { formatThaiDateTime } from "@/lib/i18n/labels";
import type { PendingApprovalsSummary } from "@/lib/approvals/pending-summary";

export function PendingApprovalsCard({ summary }: { summary: PendingApprovalsSummary }) {
  const { count, oldest } = summary;

  if (count === 0) {
    return (
      <Link
        href="/review"
        className="border-edge bg-card shadow-card rounded-card hover:bg-sunk focus-visible:ring-action flex items-center justify-between gap-3 border p-4 transition-colors focus:outline-none focus-visible:ring-2"
      >
        <span className="flex items-center gap-2">
          <ClipboardCheck aria-hidden className="text-ink-muted size-5" />
          <span className="text-ink-secondary text-body">ไม่มีงานรอตรวจ</span>
        </span>
        <ArrowRight aria-hidden className="text-ink-muted size-5" />
      </Link>
    );
  }

  return (
    <Link
      href="/review"
      aria-label={`รอตรวจ ${count} งานรออนุมัติ`}
      className="border-attn-edge bg-attn-soft shadow-card rounded-card hover:border-attn focus-visible:ring-action flex flex-col gap-2 border p-4 transition-colors focus:outline-none focus-visible:ring-2"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <ClipboardCheck aria-hidden className="text-attn-ink size-5" />
          <span className="text-attn-ink text-body font-semibold">รอตรวจ</span>
        </span>
        <ArrowRight aria-hidden className="text-attn-ink size-5" />
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-attn-ink text-3xl leading-none font-bold">{count}</span>
        <span className="text-attn-ink text-body">งานรออนุมัติ</span>
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
