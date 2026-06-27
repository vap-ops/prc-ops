// Spec 135 U2/U3/U5 / ADR 0054 — the consolidated การจัดส่ง (Delivery) block on the PO
// detail. A PO ships in deliveries procurement arranges; this lists them. Each งวด is
// a LINK to its delivery detail page (U5), which owns the proof attach — so this
// section keeps a SINGLE action: สร้างงวดจัดส่ง (procurement splits the PO into more
// deliveries, U3). One delivery (the 85% default) → a calm linked row; multiple → the
// งวดส่ง list. Server-safe (no 'use client'); the split control is a client child.

import { Check, ChevronRight } from "lucide-react";
import { formatThaiDate, PURCHASE_ORDER_STATUS_LABEL } from "@/lib/i18n/labels";
import { purchaseOrderStatusPillClasses } from "@/lib/status-colors";
import { purchaseOrderStatusIcon } from "@/lib/status-icons";
import { StatusPill } from "@/components/features/common/status-pill";
import Link from "next/link";
import { deliveryOrdinalLabel, type DeliveryView } from "@/lib/purchasing/po-deliveries";
import { deliveryDetailHref } from "@/lib/nav/order-paths";
import {
  SplitDeliveryControl,
  type SplittableLine,
} from "@/components/features/purchasing/split-delivery-control";

function headline(d: DeliveryView): string {
  if (d.status === "received") return "ส่งครบแล้ว";
  if (d.eta) return `กำหนดส่ง ${formatThaiDate(d.eta)}`;
  return "รอกำหนดส่ง";
}

export function PoDeliverySection({
  purchaseOrderId,
  deliveries,
  canManageDeliveries = false,
  splittableLines = [],
  activeCountByDelivery = {},
}: {
  purchaseOrderId: string;
  deliveries: DeliveryView[];
  // Spec 135 U3: back office can split a PO into more deliveries (procurement plans
  // งวดส่ง; site never creates). A split is only possible when some delivery still
  // holds >= 2 active lines (move >= 1, leave >= 1).
  canManageDeliveries?: boolean;
  splittableLines?: SplittableLine[];
  activeCountByDelivery?: Record<string, number>;
}) {
  const multi = deliveries.length > 1;
  const canSplit =
    canManageDeliveries &&
    splittableLines.length > 0 &&
    Object.values(activeCountByDelivery).some((c) => c >= 2);

  return (
    <div className="rounded-card border-edge bg-card shadow-card border p-4">
      <h2 className="text-ink text-base font-semibold">การจัดส่ง</h2>

      {/* Each delivery is a link to its detail page (U5: proof lives there). */}
      <ul className="mt-3 flex flex-col gap-2">
        {deliveries.map((d) => (
          <li key={d.id}>
            <Link
              href={deliveryDetailHref(purchaseOrderId, d.id)}
              className="border-edge hover:bg-sunk focus-visible:ring-action flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2"
            >
              <span className="text-ink min-w-0">
                {multi ? (
                  <>
                    {deliveryOrdinalLabel(d.ordinal)}
                    <span className="text-ink-secondary">
                      {" "}
                      · {d.lineCount} รายการ
                      {d.eta ? ` · กำหนด ${formatThaiDate(d.eta)}` : ""}
                    </span>
                  </>
                ) : (
                  headline(d)
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {d.status === "received" && d.receivedAt ? (
                  <span className="text-done-strong inline-flex items-center gap-1 text-xs font-medium">
                    <Check aria-hidden className="size-3.5" />
                    {formatThaiDate(d.receivedAt)}
                  </span>
                ) : null}
                <StatusPill
                  pillClasses={purchaseOrderStatusPillClasses(d.status)}
                  icon={purchaseOrderStatusIcon(d.status)}
                >
                  {PURCHASE_ORDER_STATUS_LABEL[d.status]}
                </StatusPill>
                <ChevronRight aria-hidden className="text-ink-muted size-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Spec 135 U3: procurement splits the PO into more delivery installments. */}
      {canSplit ? (
        <div className="mt-3">
          <SplitDeliveryControl
            purchaseOrderId={purchaseOrderId}
            lines={splittableLines}
            activeCountByDelivery={activeCountByDelivery}
          />
        </div>
      ) : null}
    </div>
  );
}
