// Spec 138 U1 — the "ต้องติดตามด่วน" urgent-follow-up panel. The procurement
// worklist's headline phone affordance: the actual overdue deliveries (the items
// behind the เกินกำหนด count), each tapping into the request, with a footer link
// to the full overdue (chase) filter. Server-safe presentational component — no
// 'use client', no handlers; rows are plain anchors like the slim request card
// (spec 47). Field-First tokens only (danger trio + ink/edge/card).

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";

import type { OverdueAttentionItem } from "@/lib/purchasing/overdue-attention";
import { bahtWithSymbol } from "@/lib/format";
import { formatPrNumber } from "@/lib/purchasing/format-id";

// Null-guarded THB formatter — "—" for a missing amount, else the SSOT formatter.
const bahtOrDash = (n: number | null) => (n == null ? "—" : bahtWithSymbol(n));

interface OverdueFollowUpPanelProps {
  items: OverdueAttentionItem[];
  /** The เกินกำหนด chase-filter target (same as the overdue KPI tile). */
  overdueHref: string;
}

export function OverdueFollowUpPanel({ items, overdueHref }: OverdueFollowUpPanelProps) {
  return (
    <section className="rounded-card border-edge bg-card shadow-card overflow-hidden border">
      <div className="border-edge flex items-center gap-2.5 border-b px-4 py-3">
        <span className="bg-danger-soft text-danger inline-flex size-6 items-center justify-center rounded-md">
          <AlertTriangle aria-hidden className="size-3.5" />
        </span>
        <h3 className="text-body text-ink font-bold">ต้องติดตามด่วน</h3>
        <span className="bg-danger-soft text-danger text-meta ml-auto rounded-full px-2 py-0.5 font-bold">
          {items.length} รายการ
        </span>
      </div>

      <ul>
        {items.map((it) => (
          <li key={it.id}>
            <Link
              href={`/requests/${it.id}`}
              className="border-edge hover:bg-page active:bg-sunk focus-visible:ring-action flex items-center gap-3 border-b px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
            >
              <span aria-hidden className="bg-danger size-1.5 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="text-ink block truncate text-sm font-semibold">
                  <span className="text-ink-muted mr-1.5 font-mono text-xs">
                    {formatPrNumber(it.prNumber)}
                  </span>
                  {it.itemDescription}
                </span>
                <span className="text-ink-secondary block truncate text-xs">
                  {it.supplier ?? "—"}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="text-danger block font-mono text-xs font-semibold">
                  เกิน {it.overdueDays} วัน
                </span>
                <span className="text-ink-secondary block font-mono text-xs">
                  {bahtOrDash(it.amount)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href={overdueHref}
        className="bg-danger-soft text-danger-strong hover:bg-danger-edge/40 focus-visible:ring-action flex items-center justify-center gap-1.5 px-4 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        ดูทั้งหมดที่เกินกำหนด
        <ChevronRight aria-hidden className="size-3.5" />
      </Link>
    </section>
  );
}
