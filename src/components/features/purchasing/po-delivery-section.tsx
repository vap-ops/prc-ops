// Spec 135 U2/U3/U4 / ADR 0054 — the consolidated การจัดส่ง (Delivery) block. A PO
// ships in deliveries procurement arranges; this renders them. One delivery (the 85%
// whole-PO default) → a simple ETA/status line; multiple (procurement split, the 15%)
// → the งวดส่ง list, each with its derived status + ETA + receipt date. Procurement
// (back office) can split the PO into more deliveries (U3). Proof of delivery scopes
// to a delivery (U4): one block for the default, per-งวด when split. รับของ (the
// site's receive action) is a separate section. Server-safe (no 'use client') — the
// split control + proof uploader are client children.

import { Check } from "lucide-react";
import {
  formatThaiDate,
  PROOF_OF_DELIVERY_LABEL,
  PURCHASE_ORDER_STATUS_LABEL,
} from "@/lib/i18n/labels";
import { purchaseOrderStatusPillClasses } from "@/lib/status-colors";
import { StatusPill } from "@/components/features/common/status-pill";
import type { DeliveryView, ProofDeliveryDoc } from "@/lib/purchasing/po-deliveries";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { AttachmentPdf } from "@/components/features/purchasing/attachment-pdf";
import { ProofOfDeliveryUploader } from "@/components/features/purchasing/proof-of-delivery-uploader";
import {
  SplitDeliveryControl,
  type SplittableLine,
} from "@/components/features/purchasing/split-delivery-control";

function headline(d: DeliveryView): string {
  if (d.status === "received") return "ส่งครบแล้ว";
  if (d.eta) return `กำหนดส่ง ${formatThaiDate(d.eta)}`;
  return "รอกำหนดส่ง";
}

// Spec 135 U4 — the proof-of-delivery gallery + uploader for ONE delivery. `heading`
// labels the งวด when the PO has more than one delivery; null for the single-delivery
// 85% case (just "หลักฐานการจัดส่ง").
function DeliveryProofBlock({
  purchaseOrderId,
  deliveryId,
  heading,
  docs,
  urls,
}: {
  purchaseOrderId: string;
  deliveryId: string;
  heading: string | null;
  docs: ProofDeliveryDoc[];
  urls: Map<string, string>;
}) {
  const images = docs.filter((d) => d.kind === "image");
  const pdfs = docs.filter((d) => d.kind === "pdf");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-secondary text-xs font-medium">
        {heading ? `${heading} · ` : ""}
        {PROOF_OF_DELIVERY_LABEL}
      </p>
      {images.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((doc, idx, arr) => {
            const url = doc.id ? urls.get(doc.id) : undefined;
            if (!doc.id || !url) return null;
            const groupUrls = arr.flatMap((a) =>
              a.id && urls.get(a.id) ? [urls.get(a.id) as string] : [],
            );
            const groupIndex = arr.slice(0, idx).filter((a) => a.id && urls.get(a.id)).length;
            return (
              <li key={doc.id} className="flex flex-col items-center gap-0.5">
                <span className="border-edge block h-20 w-20 overflow-hidden rounded-lg border">
                  <ZoomablePhoto src={url} group={groupUrls} groupIndex={groupIndex} />
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {pdfs.map((doc) => {
        const url = doc.id ? urls.get(doc.id) : undefined;
        if (!doc.id || !url) return null;
        return <AttachmentPdf key={doc.id} src={url} />;
      })}
      {docs.length === 0 ? (
        <p className="text-ink-secondary text-xs">ยังไม่มี{PROOF_OF_DELIVERY_LABEL}</p>
      ) : null}
      <ProofOfDeliveryUploader purchaseOrderId={purchaseOrderId} deliveryId={deliveryId} />
    </div>
  );
}

export function PoDeliverySection({
  purchaseOrderId,
  deliveries,
  proofByDelivery,
  proofUrls,
  canManageDeliveries = false,
  splittableLines = [],
  activeCountByDelivery = {},
}: {
  purchaseOrderId: string;
  deliveries: DeliveryView[];
  // Spec 135 U4: proof docs grouped by the delivery they document (legacy NULL under
  // the default delivery — see groupProofByDelivery).
  proofByDelivery: Map<string, ProofDeliveryDoc[]>;
  proofUrls: Map<string, string>;
  // Spec 135 U3: back office can split a PO into more deliveries (procurement plans
  // งวดส่ง; site never creates). A split is only possible when some delivery still
  // holds >= 2 active lines (move >= 1, leave >= 1).
  canManageDeliveries?: boolean;
  splittableLines?: SplittableLine[];
  activeCountByDelivery?: Record<string, number>;
}) {
  const multi = deliveries.length > 1;
  const single = deliveries.length === 1 ? deliveries[0] : null;
  const canSplit =
    canManageDeliveries &&
    splittableLines.length > 0 &&
    Object.values(activeCountByDelivery).some((c) => c >= 2);

  return (
    <div className="rounded-card border-edge bg-card shadow-card border p-4">
      <h2 className="text-ink text-base font-semibold">การจัดส่ง</h2>

      {/* One delivery (the whole-PO default) → a calm status line; multiple → the
          งวดส่ง list. */}
      {multi ? (
        <ul className="mt-3 flex flex-col gap-2">
          {deliveries.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink min-w-0">
                งวดที่ {d.ordinal}
                <span className="text-ink-secondary">
                  {" "}
                  · {d.lineCount} รายการ
                  {d.eta ? ` · กำหนด ${formatThaiDate(d.eta)}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {d.status === "received" && d.receivedAt ? (
                  <span className="text-done-strong inline-flex items-center gap-1 text-xs font-medium">
                    <Check aria-hidden className="size-3.5" />
                    {formatThaiDate(d.receivedAt)}
                  </span>
                ) : null}
                <StatusPill pillClasses={purchaseOrderStatusPillClasses(d.status)}>
                  {PURCHASE_ORDER_STATUS_LABEL[d.status]}
                </StatusPill>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-secondary mt-1 text-xs">
          {single ? headline(single) : "รอกำหนดส่ง"}
        </p>
      )}

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

      {/* Spec 135 U4: proof of delivery, scoped per delivery — one block for the 85%
          default, per งวด when the PO is split. */}
      <div className="border-edge mt-3 flex flex-col gap-4 border-t pt-3">
        {deliveries.map((d) => (
          <DeliveryProofBlock
            key={d.id}
            purchaseOrderId={purchaseOrderId}
            deliveryId={d.id}
            heading={multi ? `งวดที่ ${d.ordinal}` : null}
            docs={proofByDelivery.get(d.id) ?? []}
            urls={proofUrls}
          />
        ))}
      </div>
    </div>
  );
}
