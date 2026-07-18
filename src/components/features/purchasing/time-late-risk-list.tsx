// Spec 327 U3 — the เสี่ยงช้า list: every SSOT-flagged PR, most-late first,
// each row stating its conflict AND opening the exact PR it warns about
// (§0.2 — one tap from problem to fix surface; the overdue-follow-up-panel
// row idiom). Server component, pure render.

import Link from "next/link";

import { EmptyNotice } from "@/components/features/common/notices";
import { formatThaiDate, LATE_RISK_LABEL } from "@/lib/i18n/labels";
import { withBackFrom } from "@/lib/nav/back-href";
import type { LateRiskListItem } from "@/lib/purchasing/time-view";
import { formatPrNumber } from "@/lib/purchasing/format-id";

const TIME_FROM = "/procurement/time";

export function TimeLateRiskList({ items }: { items: ReadonlyArray<LateRiskListItem> }) {
  if (items.length === 0) {
    return <EmptyNotice>ไม่มีรายการ{LATE_RISK_LABEL} — ของทุกชิ้นถึงก่อนงานเริ่ม</EmptyNotice>;
  }
  return (
    <div className="rounded-card border-edge bg-card shadow-card overflow-hidden border">
      <div className="border-edge flex items-center gap-2 border-b px-4 py-3">
        <h3 className="text-body text-ink font-bold">{LATE_RISK_LABEL}</h3>
        <span className="bg-danger-soft text-danger text-meta ml-auto rounded-full px-2 py-0.5 font-bold">
          {items.length} รายการ
        </span>
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <Link
              href={withBackFrom(`/requests/${it.id}`, TIME_FROM)}
              className="border-edge hover:bg-page active:bg-sunk focus-visible:ring-action flex min-h-11 items-center gap-3 border-b px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              <span aria-hidden className="bg-danger size-1.5 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="text-ink block truncate text-sm font-semibold">
                  <span className="text-ink-muted mr-1.5 font-mono text-xs">
                    {formatPrNumber(it.prNumber)}
                  </span>
                  {it.itemDescription}
                </span>
                <span className="text-danger text-meta block font-semibold">
                  ของถึง {formatThaiDate(it.eta!)} — งานเริ่ม {formatThaiDate(it.plannedStart)} (
                  {it.wpName})
                </span>
              </span>
              <span className="bg-danger-soft text-danger text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                +{it.daysLate} วัน
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
