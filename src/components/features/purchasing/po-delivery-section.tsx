// Spec 134 U9 — the consolidated การจัดส่ง (Delivery) block on the PO detail. This
// is the delivery home the purchase team owns: the ETA, the per-batch breakdown when
// the PO forks (งวดส่ง — partial delivery / multiple deliveries), and the
// proof-of-delivery documents procurement attaches (they arrange the delivery, so
// they provide the proof). รับของ (the site's receive action) is a separate section.
//
// Server-safe (no 'use client') — the proof uploader is a client child.

import { Check, Clock } from "lucide-react";
import { formatThaiDate, PROOF_OF_DELIVERY_LABEL } from "@/lib/i18n/labels";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";
import type { DeliveryBreakdown } from "@/lib/purchasing/delivery-batches";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { AttachmentPdf } from "@/components/features/purchasing/attachment-pdf";
import { ProofOfDeliveryUploader } from "@/components/features/purchasing/proof-of-delivery-uploader";

interface ProofDoc {
  id: string | null;
  kind: string | null;
  storage_path: string | null;
}

export function PoDeliverySection({
  purchaseOrderId,
  eta,
  status,
  breakdown,
  showBreakdown,
  proofDocs,
  proofUrls,
}: {
  purchaseOrderId: string;
  eta: string | null;
  status: PurchaseOrderStatus;
  breakdown: DeliveryBreakdown;
  /** Render the per-batch breakdown — true only when the PO actually forked. */
  showBreakdown: boolean;
  proofDocs: ProofDoc[];
  proofUrls: Map<string, string>;
}) {
  const proofImages = proofDocs.filter((d) => d.kind === "image");
  const proofPdfs = proofDocs.filter((d) => d.kind === "pdf");

  return (
    <div className="rounded-card border-edge bg-card shadow-card border p-4">
      <h2 className="text-ink text-base font-semibold">การจัดส่ง</h2>

      {/* Headline: when it's coming / done. */}
      {status === "received" ? (
        <p className="text-done-strong mt-1 text-xs font-medium">ส่งครบแล้ว</p>
      ) : eta ? (
        <p className="text-ink-secondary mt-1 text-xs">กำหนดส่ง {formatThaiDate(eta)}</p>
      ) : (
        <p className="text-ink-secondary mt-1 text-xs">รอกำหนดส่ง</p>
      )}

      {/* Branches — งวดส่ง — only when the PO forked (multi-batch or partial). */}
      {showBreakdown ? (
        <ul className="border-edge mt-3 flex flex-col gap-2 border-t pt-3">
          {breakdown.batches.map((b, i) => (
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
          {breakdown.pending ? (
            <li className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink">
                ค้างส่ง
                <span className="text-ink-secondary"> · {breakdown.pending.count} รายการ</span>
              </span>
              <span className="text-ink-secondary inline-flex shrink-0 items-center gap-1 text-xs">
                <Clock aria-hidden className="size-3.5" />
                {breakdown.pending.earliestEta
                  ? `คาด ${formatThaiDate(breakdown.pending.earliestEta)}`
                  : "ยังไม่มา"}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* Proof of delivery — procurement attaches the delivery note / POD. */}
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
