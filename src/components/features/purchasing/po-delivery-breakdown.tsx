// Spec 134 U7 — the PO delivery breakdown. When a PO arrives in more than one
// delivery (the fork the progress tracker can't show linearly), this lists each
// received batch (งวดที่ N · count · receipt date) plus the pending remainder
// (ค้างส่ง · count · earliest eta). Server-safe presentational component — the page
// only renders it when a fork actually exists (multi-batch or a pending remainder),
// so the 85% one-delivery PO never sees it.

import { Check, Clock } from "lucide-react";
import { formatThaiDate } from "@/lib/i18n/labels";
import type { DeliveryBreakdown } from "@/lib/purchasing/delivery-batches";

export function PoDeliveryBreakdown({ breakdown }: { breakdown: DeliveryBreakdown }) {
  const { batches, pending } = breakdown;

  return (
    <div className="rounded-card border-edge bg-card shadow-card border p-4">
      <h2 className="text-ink text-base font-semibold">การจัดส่ง</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {batches.map((b, i) => (
          <li key={b.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink">
              งวดที่ {i + 1}
              <span className="text-ink-secondary"> · {b.count} รายการ</span>
            </span>
            <span className="text-done-strong inline-flex shrink-0 items-center gap-1 text-xs font-medium">
              <Check aria-hidden className="size-3.5" />
              รับแล้ว {b.receivedAt ? formatThaiDate(b.receivedAt) : "—"}
            </span>
          </li>
        ))}
        {pending ? (
          <li className="flex items-center justify-between gap-3 text-sm">
            <span className="text-ink">
              ค้างส่ง
              <span className="text-ink-secondary"> · {pending.count} รายการ</span>
            </span>
            <span className="text-ink-secondary inline-flex shrink-0 items-center gap-1 text-xs">
              <Clock aria-hidden className="size-3.5" />
              {pending.earliestEta ? `คาด ${formatThaiDate(pending.earliestEta)}` : "ยังไม่มา"}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
