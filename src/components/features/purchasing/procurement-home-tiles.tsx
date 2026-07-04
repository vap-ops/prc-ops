// Spec 262 U4 — the /requests procurement home tiles: เดือนนี้สั่งซื้อ (this
// month's committed spend vs the same day-of-month last month), PO ค้างส่ง
// (undelivered POs + the worst wait), ค้างรับเข้า (delivered store-bound
// arrivals not yet logged into the store). Server-safe (no 'use client') —
// plain <Link> tiles, the WorklistKpiTile card pattern.

import Link from "next/link";
import { TrendingUp, TrendingDown, Truck, PackageSearch } from "lucide-react";
import type { MonthSpendTrend, PendingPoSummary } from "@/lib/purchasing/procurement-home-tiles";
import { bahtCompact as baht } from "@/lib/format";

const CARD =
  "rounded-card flex min-h-[92px] flex-col justify-between gap-3 border-[1.5px] border-edge bg-card p-4 text-ink";
const LINK_CARD = `${CARD} focus-visible:ring-action transition-shadow hover:shadow-card focus:outline-none focus-visible:ring-2`;

export function ProcurementHomeTiles({
  monthTrend,
  pendingPoSummary,
  pendingStoreReceiptCount,
}: {
  monthTrend: MonthSpendTrend;
  pendingPoSummary: PendingPoSummary;
  pendingStoreReceiptCount: number;
}) {
  const TrendIcon = (monthTrend.pctChange ?? 0) < 0 ? TrendingDown : TrendingUp;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Link href="/requests/reports?preset=month" className={LINK_CARD}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta font-semibold">เดือนนี้สั่งซื้อ</span>
          <span className="bg-sunk text-ink-secondary inline-flex size-7 items-center justify-center rounded-lg">
            <TrendIcon aria-hidden className="size-4" />
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-2xl leading-none font-extrabold tabular-nums">
            {baht(monthTrend.currentMonth)}
          </div>
          <div className="text-meta text-ink-muted mt-1 font-medium">
            {monthTrend.pctChange === null
              ? "ไม่มีข้อมูลเดือนก่อนเทียบ"
              : `${monthTrend.pctChange > 0 ? "+" : ""}${monthTrend.pctChange}% จากเดือนก่อน`}
          </div>
        </div>
      </Link>

      <Link href="/requests/orders?pending=1" className={LINK_CARD}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta font-semibold">PO ค้างส่ง</span>
          <span className="bg-sunk text-ink-secondary inline-flex size-7 items-center justify-center rounded-lg">
            <Truck aria-hidden className="size-4" />
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-3xl leading-none font-extrabold tabular-nums">
            {pendingPoSummary.count}
          </div>
          <div className="text-meta text-ink-muted mt-1 font-medium">
            {pendingPoSummary.worstAgingDays !== null
              ? `รอนานสุด ${pendingPoSummary.worstAgingDays} วัน`
              : "ไม่มีใบสั่งซื้อค้างส่ง"}
          </div>
        </div>
      </Link>

      <Link href="/requests/orders" className={LINK_CARD}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta font-semibold">ค้างรับเข้า</span>
          <span className="bg-sunk text-ink-secondary inline-flex size-7 items-center justify-center rounded-lg">
            <PackageSearch aria-hidden className="size-4" />
          </span>
        </div>
        <div className="min-w-0">
          <div className="text-3xl leading-none font-extrabold tabular-nums">
            {pendingStoreReceiptCount}
          </div>
          <div className="text-meta text-ink-muted mt-1 font-medium">รอบันทึกเข้าคลัง</div>
        </div>
      </Link>
    </div>
  );
}
