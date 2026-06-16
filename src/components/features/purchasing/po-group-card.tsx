// Spec 134 U2 — the phone worklist PO card. In the procurement กำลังจัดส่ง band,
// a bundled order's member tickets collapse into ONE card linking to the PO detail
// (spec 134 U1) instead of scattering as loose rows. Server-safe presentational
// component (no 'use client'): one anchor, no handlers. The derived status + line
// count are computed by the page from the PO's full member set (the same roll-up
// the detail page shows), so the card reads consistently with /requests/orders/[id].

import Link from "next/link";
import { ChevronRight, Package } from "lucide-react";
import { StatusPill } from "@/components/features/common/status-pill";
import { PURCHASE_ORDER_STATUS_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import { purchaseOrderStatusPillClasses } from "@/lib/status-colors";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";

export interface PoGroupCardProps {
  poId: string;
  poNumber: number;
  supplier: string;
  status: PurchaseOrderStatus;
  lineCount: number;
  eta: string | null;
}

export function PoGroupCard({
  poId,
  poNumber,
  supplier,
  status,
  lineCount,
  eta,
}: PoGroupCardProps) {
  return (
    <Link
      href={`/requests/orders/${poId}`}
      className="rounded-card border-edge bg-card shadow-card hover:bg-page focus-visible:ring-action active:bg-sunk block border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-ink-secondary flex items-center gap-1.5 text-xs">
            <Package aria-hidden className="size-3.5 shrink-0" />
            <span className="font-mono">PO-{String(poNumber).padStart(4, "0")}</span>
            <span className="mx-0.5">·</span>
            ใบสั่งซื้อรวม
          </p>
          <p className="text-ink truncate text-base font-medium">{supplier}</p>
          <p className="text-ink-secondary text-xs">
            {lineCount} รายการ
            {eta ? (
              <>
                <span className="text-ink-muted mx-1">·</span>
                กำหนดรับของ {formatThaiDate(eta)}
              </>
            ) : null}
          </p>
        </div>
        <span className="flex shrink-0 items-start gap-1.5">
          <StatusPill pillClasses={purchaseOrderStatusPillClasses(status)}>
            {PURCHASE_ORDER_STATUS_LABEL[status]}
          </StatusPill>
          <ChevronRight aria-hidden className="text-ink-muted mt-1 size-4 shrink-0" />
        </span>
      </div>
    </Link>
  );
}
