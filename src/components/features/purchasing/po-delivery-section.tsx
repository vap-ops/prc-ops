// Spec 135 U2 / ADR 0054 — the consolidated การจัดส่ง (Delivery) block. A PO ships in
// deliveries procurement arranges; this renders them. One delivery (the 85%
// whole-PO default) → a simple ETA/status line; multiple (procurement split, the 15%)
// → the งวดส่ง list, each with its derived status + ETA + receipt date. Plus the
// proof-of-delivery docs procurement attaches. รับของ (the site's receive action) is
// a separate section. Server-safe (no 'use client') — the proof uploader is a client
// child. (Replaces the U7/U9 receipt-batch breakdown with the real deliveries.)

import { Check } from "lucide-react";
import {
  formatThaiDate,
  PROOF_OF_DELIVERY_LABEL,
  PURCHASE_ORDER_STATUS_LABEL,
} from "@/lib/i18n/labels";
import { purchaseOrderStatusPillClasses } from "@/lib/status-colors";
import { StatusPill } from "@/components/features/common/status-pill";
import type { DeliveryView } from "@/lib/purchasing/po-deliveries";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { AttachmentPdf } from "@/components/features/purchasing/attachment-pdf";
import { ProofOfDeliveryUploader } from "@/components/features/purchasing/proof-of-delivery-uploader";

interface ProofDoc {
  id: string | null;
  kind: string | null;
  storage_path: string | null;
}

function headline(d: DeliveryView): string {
  if (d.status === "received") return "ส่งครบแล้ว";
  if (d.eta) return `กำหนดส่ง ${formatThaiDate(d.eta)}`;
  return "รอกำหนดส่ง";
}

export function PoDeliverySection({
  purchaseOrderId,
  deliveries,
  proofDocs,
  proofUrls,
}: {
  purchaseOrderId: string;
  deliveries: DeliveryView[];
  proofDocs: ProofDoc[];
  proofUrls: Map<string, string>;
}) {
  const proofImages = proofDocs.filter((d) => d.kind === "image");
  const proofPdfs = proofDocs.filter((d) => d.kind === "pdf");
  const multi = deliveries.length > 1;
  const single = deliveries.length === 1 ? deliveries[0] : null;

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

      {/* Proof of delivery — procurement attaches the delivery note / POD (PO-level
          until U4 scopes it per delivery). */}
      <div className="border-edge mt-3 flex flex-col gap-2 border-t pt-3">
        <p className="text-ink-secondary text-xs font-medium">{PROOF_OF_DELIVERY_LABEL}</p>
        {proofImages.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {proofImages.map((doc, idx, arr) => {
              const url = doc.id ? proofUrls.get(doc.id) : undefined;
              if (!doc.id || !url) return null;
              const groupUrls = arr.flatMap((a) =>
                a.id && proofUrls.get(a.id) ? [proofUrls.get(a.id) as string] : [],
              );
              const groupIndex = arr
                .slice(0, idx)
                .filter((a) => a.id && proofUrls.get(a.id)).length;
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
        {proofPdfs.map((doc) => {
          const url = doc.id ? proofUrls.get(doc.id) : undefined;
          if (!doc.id || !url) return null;
          return <AttachmentPdf key={doc.id} src={url} />;
        })}
        {proofDocs.length === 0 ? (
          <p className="text-ink-secondary text-xs">ยังไม่มี{PROOF_OF_DELIVERY_LABEL}</p>
        ) : null}
        <ProofOfDeliveryUploader purchaseOrderId={purchaseOrderId} />
      </div>
    </div>
  );
}
