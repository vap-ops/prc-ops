// Spec 135 U5 — the proof-of-delivery gallery + uploader for ONE delivery, rendered
// on the delivery detail page (moved off the PO detail's การจัดส่ง section so that
// section keeps a single action). Scoped to a delivery (U4 delivery_id); legacy NULL
// proof is grouped under the default delivery upstream. Server-safe — the gallery +
// uploader are client children.

import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { AttachmentPdf } from "@/components/features/purchasing/attachment-pdf";
import { ProofOfDeliveryUploader } from "@/components/features/purchasing/proof-of-delivery-uploader";
import { PROOF_OF_DELIVERY_LABEL } from "@/lib/i18n/labels";
import type { ProofDeliveryDoc } from "@/lib/purchasing/po-deliveries";

export function DeliveryProofBlock({
  purchaseOrderId,
  deliveryId,
  docs,
  urls,
  captureUploader = false,
  uploaderLabel,
}: {
  purchaseOrderId: string;
  deliveryId: string;
  docs: ProofDeliveryDoc[];
  urls: Map<string, string>;
  /** Spec 308: the SA receive page takes the proof LIVE (rear camera) and
   *  names the button; the BO งวด page keeps the defaults. */
  captureUploader?: boolean;
  uploaderLabel?: string;
}) {
  const images = docs.filter((d) => d.kind === "image");
  const pdfs = docs.filter((d) => d.kind === "pdf");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink-secondary text-xs font-medium">{PROOF_OF_DELIVERY_LABEL}</p>
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
      <ProofOfDeliveryUploader
        purchaseOrderId={purchaseOrderId}
        deliveryId={deliveryId}
        capture={captureUploader}
        {...(uploaderLabel != null ? { label: uploaderLabel } : {})}
      />
    </div>
  );
}
