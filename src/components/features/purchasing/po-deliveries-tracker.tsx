// Spec 135 U6 / ADR 0054 — the PO progress tracker BRANCHED per delivery. When a PO
// ships in multiple งวด, the single rolled-up stepper hides per-delivery progress; this
// renders each งวด's own สั่งซื้อ → จัดส่ง → รับของ stepper (from its derived status),
// left-ruled so it reads as a branch. The single-delivery PO keeps the one linear
// tracker (caller decides). Server-safe presentational.

import { formatThaiDate } from "@/lib/i18n/labels";
import { deliveryOrdinalLabel, type DeliveryView } from "@/lib/purchasing/po-deliveries";
import { PurchaseOrderTracker } from "@/components/features/purchasing/purchase-order-tracker";

export function PoDeliveriesTracker({ deliveries }: { deliveries: DeliveryView[] }) {
  return (
    <div className="flex flex-col gap-4">
      {deliveries.map((d) => (
        <div key={d.id} className="border-edge-strong border-l-2 pl-3">
          <p className="text-ink-secondary mb-2 text-xs font-medium">
            {deliveryOrdinalLabel(d.ordinal)}
            {d.eta ? (
              <span className="text-ink-muted"> · กำหนด {formatThaiDate(d.eta)}</span>
            ) : null}
          </p>
          <PurchaseOrderTracker status={d.status} />
        </div>
      ))}
    </div>
  );
}
