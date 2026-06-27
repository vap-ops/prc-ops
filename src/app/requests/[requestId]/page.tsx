import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { StatusPill } from "@/components/features/common/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASING_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { workPackageHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { createClient } from "@/lib/db/server";
import { isValidUuid } from "@/lib/photos/path";
import { PR_LIST_COLUMNS } from "@/lib/purchasing/columns";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import { PoNumberTag } from "@/components/features/purchasing/po-number-tag";

// /requests/[requestId] — the order detail screen (spec 47). The list
// card is a slim summary now; every fact and action moved here. Same
// audience gate as /requests (ADR 0022/0026); RLS decides whether the
// row is readable — an unknown id and a forbidden id both render the
// Thai 404 (the /requests ?wp= convention).

import {
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  formatThaiDate,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import {
  purchaseRequestPriorityPillClasses,
  purchaseRequestStatusPillClasses,
} from "@/lib/status-colors";
import { purchaseRequestPriorityIcon, purchaseRequestStatusIcon } from "@/lib/status-icons";
import { PurchaseRequestTracker } from "@/components/features/purchasing/purchase-request-tracker";
import { PurchaseRequestNotes } from "@/components/features/purchasing/purchase-request-notes";
import { PurchaseRequestDecision } from "@/components/features/purchasing/purchase-request-decision";
import { PurchaseRequestCancel } from "@/components/features/purchasing/purchase-request-cancel";
import {
  PriceComparison,
  type PurchaseQuote,
  type ItemPriceHistory,
} from "@/components/features/purchasing/price-comparison";
import { PurchaseRequestShip } from "@/components/features/purchasing/purchase-request-ship";
import { isBackOfficeRole } from "@/lib/purchasing/back-office";
import { DeliveryPhotoUploader } from "@/components/features/purchasing/delivery-photo-uploader";
import { PurchaseRequestAttachmentStager } from "@/components/features/purchasing/purchase-request-attachment-stager";
import { AttachmentRemoveButton } from "@/components/features/purchasing/attachment-remove-button";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { loadRequestDetail } from "@/lib/purchasing/load-request-detail";
import { mintSignedUrlsForAttachments } from "@/lib/purchasing/attachment-signed-urls";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { AttentionCard } from "@/components/features/common/attention-card";
import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import { PaymentProofUploader } from "@/components/features/purchasing/payment-proof-uploader";
import { AttachmentPdf } from "@/components/features/purchasing/attachment-pdf";
import { SitePurchaseAcknowledge } from "@/components/features/purchasing/site-purchase-acknowledge";

export const metadata = { title: "รายละเอียดคำขอซื้อ" };

interface PageProps {
  params: Promise<{ requestId: string }>;
}

export default async function RequestDetailPage({ params }: PageProps) {
  const ctx = await requireRole(PURCHASING_ROLES);
  const { requestId } = await params;

  // Non-UUID params skip the query entirely — same shape as the ?wp=
  // resolution on /requests; "garbage", "unknown", and "not allowed"
  // are deliberately indistinguishable.
  if (!isValidUuid(requestId)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("purchase_requests")
    .select(`${PR_LIST_COLUMNS}, notes, source, acknowledged_at, catalog_item_id`)
    .eq("id", requestId)
    .maybeSingle();

  if (!request) {
    notFound();
  }

  const status = request.status;
  const priority = request.priority;
  const isMine = request.requested_by === ctx.id;

  const isDecider = isManagerRole(ctx.role);
  // Spec 70: the WP detail route is SITE_STAFF_ROLES-gated and would bounce
  // procurement, so the WP reference renders as plain text (not a link) for it.
  const isProcurement = ctx.role === "procurement";
  // Spec 33 / ADR 0038 gate; suppliers fetched only when the form renders.
  const isBackOffice = isBackOfficeRole(ctx.role);

  // Spec 147 U3: one loader batches the request-detail reads (was a serial
  // waterfall). Same queries/columns/results — only the scheduling changes.
  const { wp, requesterName, attachments, attachmentUrls, poRow, poDocs, poDocUrls, suppliers } =
    await loadRequestDetail(supabase, request, { isBackOffice });

  // Attachment splits (spec 23/16 P2, spec 66/121): pure filters over the
  // current-state rows. Links are exactly kind 'link' (a pdf is not a link).
  const confirmations = attachments.filter((row) => row.purpose === "delivery_confirmation");
  const invoiceImages = attachments.filter(
    (row) => row.purpose === "invoice" && row.kind === "image",
  );
  const invoicePdfs = attachments.filter((row) => row.purpose === "invoice" && row.kind === "pdf");
  // Bug 2: the buyer's proof of payment (สลิปโอน), a distinct purpose.
  const paymentImages = attachments.filter(
    (row) => row.purpose === "payment" && row.kind === "image",
  );
  const paymentPdfs = attachments.filter((row) => row.purpose === "payment" && row.kind === "pdf");
  const referenceImages = attachments.filter(
    (row) => row.purpose === "reference" && row.kind === "image",
  );
  const referencePdfs = attachments.filter(
    (row) => row.purpose === "reference" && row.kind === "pdf",
  );
  const referenceLinks = attachments.filter(
    (row) => row.purpose === "reference" && row.kind === "link",
  );

  // Spec 182 U1: supplier quotes for price comparison — only on an approved PR,
  // back-office only (unit_price is money; RLS hides the table from site staff).
  let quotes: PurchaseQuote[] = [];
  if (isBackOffice && status === "approved") {
    const { data: quoteRows } = await supabase
      .from("purchase_quotes")
      .select("id, supplier_id, unit_price, note, suppliers ( name )")
      .eq("purchase_request_id", request.id)
      .order("unit_price", { ascending: true });
    quotes = (quoteRows ?? []).map((q) => ({
      id: q.id,
      supplierId: q.supplier_id,
      supplierName: q.suppliers?.name ?? "—",
      unitPrice: Number(q.unit_price),
      note: q.note,
    }));
  }

  // Spec 182 U3: the last-paid benchmark — recent net prices paid for this PR's
  // catalog item (the spec-179 link). Back-office + approved only, and only when
  // the request is linked to a catalog item (off-catalog requests have no axis).
  let priceHistory: ItemPriceHistory[] = [];
  if (isBackOffice && status === "approved" && request.catalog_item_id) {
    const { data: historyRows } = await supabase.rpc("item_price_history", {
      p_catalog_item_id: request.catalog_item_id,
    });
    priceHistory = (historyRows ?? []).map((h) => ({
      supplierName: h.supplier_name ?? "—",
      netUnitPrice: Number(h.net_unit_price),
      quantity: Number(h.quantity),
      purchasedAt: h.purchased_at,
    }));
  }

  // Spec 182 U4: each quote's attached source document (quote_id → signed URL).
  // Back-office + approved only (the RESTRICTIVE RLS also hides quote rows from
  // anyone else); the bytes live in the private pr-attachments bucket.
  const quoteDocs: Record<string, string> = {};
  if (isBackOffice && status === "approved") {
    const { data: docRows } = await supabase
      .from("purchase_request_attachments_current")
      .select("id, quote_id, storage_path")
      .eq("purchase_request_id", request.id)
      .eq("purpose", "quote");
    const rows = (docRows ?? []).filter((r) => r.quote_id && r.storage_path);
    const urls = await mintSignedUrlsForAttachments(
      rows.map((r) => ({ id: r.id ?? "", storage_path: r.storage_path })),
    );
    for (const r of rows) {
      const url = r.id ? urls.get(r.id) : undefined;
      if (r.quote_id && url) quoteDocs[r.quote_id] = url;
    }
  }

  // Spec 125/134: the PO this ticket belongs to (number + source docs) — link target.
  const poId = request.purchase_order_id;
  // Spec 73: the note is editable by its requester or by back-office.
  const canEditNotes = isMine || isBackOffice;
  // Spec 66 / ADR 0043: on-site purchase + PM-ack state.
  const isSitePurchase = request.source === "site_purchase";
  const ackAt = request.acknowledged_at;

  const hasActions =
    (isDecider && status === "requested") ||
    (isBackOffice && status === "approved") ||
    (isBackOffice && status === "purchased") ||
    (isDecider && status === "approved");

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 63: the consolidated shell. */}
      <DetailHeader backHref="/requests" backLabel="กลับไปจัดซื้อ">
        {wp ? (
          isProcurement ? (
            <span className="text-ink-secondary w-fit truncate text-xs">
              <span className="font-mono">{wp.code}</span>
              <span className="mx-1">·</span>
              {wp.name}
            </span>
          ) : (
            <Link
              href={withBackFrom(workPackageHref(wp.project_id, wp.id), `/requests/${requestId}`)}
              className="text-ink-secondary w-fit truncate text-xs hover:underline focus:outline-none focus-visible:underline"
            >
              <span className="font-mono">{wp.code}</span>
              <span className="mx-1">·</span>
              {wp.name}
            </Link>
          )
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink-secondary font-mono text-xs">
              {formatPrNumber(request.pr_number)}
            </p>
            {/* Spec 57: the page's subject never truncates. */}
            <h1 className={DETAIL_TITLE}>{request.item_description}</h1>
          </div>
          <span className="mt-1 flex shrink-0 flex-col items-end gap-1">
            <StatusPill
              pillClasses={purchaseRequestStatusPillClasses(status)}
              icon={purchaseRequestStatusIcon(status)}
            >
              {PURCHASE_REQUEST_STATUS_LABEL[status]}
            </StatusPill>
            {priority !== "normal" ? (
              <StatusPill
                pillClasses={purchaseRequestPriorityPillClasses(priority)}
                icon={purchaseRequestPriorityIcon(priority)}
              >
                {PURCHASE_REQUEST_PRIORITY_LABEL[priority]}
              </StatusPill>
            ) : null}
          </span>
        </div>
      </DetailHeader>

      <section className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        <div className="rounded-card border-edge bg-card shadow-card border p-4">
          <p className="text-ink text-sm">
            จำนวน {request.quantity} {request.unit}
          </p>
          <p className="text-ink-secondary mt-1 text-xs">
            {isMine ? (
              <span className="border-action bg-action-soft text-action mr-1.5 inline-flex items-center rounded-full border px-1.5 text-[10px] font-semibold">
                ของฉัน
              </span>
            ) : null}
            ขอซื้อโดย {requesterName}
            <span className="text-ink-muted mx-1">·</span>
            ขอเมื่อ {formatThaiDate(request.requested_at)}
          </p>
          {request.needed_by ? (
            <p className="text-ink-secondary mt-1 text-xs">
              ต้องการรับของภายใน {formatThaiDate(request.needed_by)}
            </p>
          ) : null}
          {/* Spec 73: the requester note is now editable — the requester
              edits their own, back-office edits any. Everyone else sees it
              read-only. */}
          {canEditNotes ? (
            <div className="mt-3">
              <PurchaseRequestNotes requestId={request.id} notes={request.notes} />
            </div>
          ) : request.notes ? (
            <p className="text-ink-secondary mt-1 text-xs whitespace-pre-wrap">
              หมายเหตุ: {request.notes}
            </p>
          ) : null}
          {/* Spec 66 / ADR 0043: the requisition stepper doesn't apply to an
              on-site purchase (it skipped request→approve); its state is told
              by the ack card + the document section instead. */}
          {isSitePurchase ? null : (
            <div className="mt-3">
              <PurchaseRequestTracker
                status={status}
                requestedAt={request.requested_at}
                decidedAt={request.decided_at}
                purchasedAt={request.purchased_at}
                shippedAt={request.shipped_at}
                deliveredAt={request.delivered_at}
                eta={request.eta}
              />
            </div>
          )}
          {status === "rejected" && request.decision_comment ? (
            /* Spec 55: the one attention pattern (spec 54). */
            <div className="mt-3">
              <AttentionCard tone="red" title="เหตุผลที่ไม่อนุมัติ">
                <p className="whitespace-pre-wrap">{request.decision_comment}</p>
                {request.decided_at ? (
                  <p className="text-ink-secondary mt-1 text-xs">
                    พิจารณาเมื่อ {formatThaiDateTime(request.decided_at)}
                  </p>
                ) : null}
              </AttentionCard>
            </div>
          ) : null}
          {request.supplier || (status === "delivered" && request.received_by) ? (
            <p className="text-ink-secondary mt-3 text-xs">
              {request.supplier ? `ผู้ขาย ${request.supplier}` : ""}
              {request.supplier && status === "delivered" && request.received_by ? " · " : ""}
              {status === "delivered" && request.received_by
                ? `ผู้รับของ ${request.received_by}`
                : ""}
            </p>
          ) : null}
          {status === "delivered" && request.delivery_note ? (
            <p className="text-ink-secondary mt-1 text-xs whitespace-pre-wrap">
              {request.delivery_note}
            </p>
          ) : null}
          {/* Spec 134 U1: this ticket belongs to a grouped PO — link to it. */}
          {poId && poRow ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs">
              <span className="text-ink-secondary">อยู่ใน</span>
              <Link
                href={`/requests/orders/${poId}`}
                className="text-action inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
              >
                <PoNumberTag poNumber={poRow.po_number} />
                <span>ใบสั่งซื้อ →</span>
              </Link>
            </p>
          ) : null}
        </div>

        {isSitePurchase && !ackAt ? (
          <AttentionCard tone="amber" title="ซื้อหน้างาน — รอ PM รับทราบ">
            <p>บันทึกการซื้อที่หน้างานแล้ว รอผู้จัดการโครงการรับทราบ</p>
            {isDecider ? (
              <div className="mt-2">
                <SitePurchaseAcknowledge requestId={request.id} />
              </div>
            ) : null}
          </AttentionCard>
        ) : null}
        {isSitePurchase && ackAt ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            <p className="text-done-strong text-sm font-medium">
              PM รับทราบการซื้อหน้างานแล้ว · {formatThaiDateTime(ackAt)}
            </p>
          </div>
        ) : null}

        {referenceImages.length > 0 ||
        referencePdfs.length > 0 ||
        referenceLinks.length > 0 ||
        (status === "requested" && isMine && wp) ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            <h2 className="text-ink text-base font-semibold">เอกสารอ้างอิง</h2>
            {referenceImages.length > 0 ? (
              <div className="mt-2">
                <p className="text-ink-secondary text-xs font-medium">รูปอ้างอิง</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {referenceImages.map((photo, idx, arr) => {
                    const url = photo.id ? attachmentUrls.get(photo.id) : undefined;
                    if (!photo.id || !url) return null;
                    /* Spec 50: reference images form one lightbox group. */
                    const groupUrls = arr.flatMap((a) =>
                      a.id && attachmentUrls.get(a.id) ? [attachmentUrls.get(a.id) as string] : [],
                    );
                    const groupIndex = arr
                      .slice(0, idx)
                      .filter((a) => a.id && attachmentUrls.get(a.id)).length;
                    return (
                      <li key={photo.id} className="flex flex-col items-center gap-0.5">
                        <span className="border-edge block h-20 w-20 overflow-hidden rounded-lg border">
                          <ZoomablePhoto src={url} group={groupUrls} groupIndex={groupIndex} />
                        </span>
                        {status === "requested" && photo.created_by === ctx.id ? (
                          <AttachmentRemoveButton attachmentId={photo.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {referencePdfs.length > 0 ? (
              <div className="mt-2">
                <p className="text-ink-secondary text-xs font-medium">เอกสาร PDF</p>
                <ul className="mt-1 flex flex-col gap-2">
                  {referencePdfs.map((doc) => {
                    const url = doc.id ? attachmentUrls.get(doc.id) : undefined;
                    if (!doc.id || !url) return null;
                    return (
                      <li key={doc.id} className="flex flex-col gap-0.5">
                        <AttachmentPdf src={url} />
                        {status === "requested" && doc.created_by === ctx.id ? (
                          <AttachmentRemoveButton attachmentId={doc.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {referenceLinks.length > 0 ? (
              <div className="mt-2">
                <p className="text-ink-secondary text-xs font-medium">ลิงก์อ้างอิง</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {referenceLinks.map((link) => {
                    if (!link.id || !link.url) return null;
                    return (
                      <li key={link.id} className="flex items-center gap-2">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-action min-w-0 flex-1 truncate text-xs underline-offset-2 hover:underline"
                        >
                          {link.url}
                        </a>
                        {status === "requested" && link.created_by === ctx.id ? (
                          <AttachmentRemoveButton attachmentId={link.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {status === "requested" && isMine ? (
              <details className="mt-2">
                <summary className="text-action cursor-pointer text-xs font-medium underline-offset-2 hover:underline">
                  เพิ่มรูปหรือลิงก์
                </summary>
                <div className="mt-2">
                  <PurchaseRequestAttachmentStager
                    projectId={request.project_id}
                    purchaseRequestId={request.id}
                    userId={ctx.id}
                  />
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {status === "delivered" || status === "on_route" ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            <h2 className="text-ink text-base font-semibold">การรับของ</h2>
            <div className="mt-2 flex flex-col gap-2">
              {confirmations.length > 0 ? (
                <div>
                  <p className="text-ink-secondary text-xs font-medium">รูปยืนยันการรับของ</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {confirmations.map((photo, idx, arr) => {
                      const url = photo.id ? attachmentUrls.get(photo.id) : undefined;
                      if (!photo.id || !url) return null;
                      /* Spec 50: confirmation photos form a separate group. */
                      const groupUrls = arr.flatMap((a) =>
                        a.id && attachmentUrls.get(a.id)
                          ? [attachmentUrls.get(a.id) as string]
                          : [],
                      );
                      const groupIndex = arr
                        .slice(0, idx)
                        .filter((a) => a.id && attachmentUrls.get(a.id)).length;
                      return (
                        <li key={photo.id} className="flex flex-col items-center gap-0.5">
                          <span className="border-edge block h-20 w-20 overflow-hidden rounded-lg border">
                            <ZoomablePhoto src={url} group={groupUrls} groupIndex={groupIndex} />
                          </span>
                          {photo.created_by === ctx.id ? (
                            <AttachmentRemoveButton attachmentId={photo.id} />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              <DeliveryPhotoUploader
                purchaseRequestId={request.id}
                projectId={request.project_id}
                userId={ctx.id}
              />
            </div>
          </div>
        ) : null}

        {poDocs.length > 0 ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            <h2 className="text-ink text-base font-semibold">
              เอกสารใบสั่งซื้อ (ใบเสนอราคา / ใบแจ้งหนี้)
            </h2>
            <div className="mt-2 flex flex-col gap-2">
              {poDocs.some((d) => d.kind === "image") ? (
                <ul className="flex flex-wrap gap-2">
                  {poDocs
                    .filter((d) => d.kind === "image")
                    .map((doc, idx, arr) => {
                      const url = doc.id ? poDocUrls.get(doc.id) : undefined;
                      if (!doc.id || !url) return null;
                      const groupUrls = arr.flatMap((a) =>
                        a.id && poDocUrls.get(a.id) ? [poDocUrls.get(a.id) as string] : [],
                      );
                      const groupIndex = arr
                        .slice(0, idx)
                        .filter((a) => a.id && poDocUrls.get(a.id)).length;
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
              {poDocs
                .filter((d) => d.kind === "pdf")
                .map((doc) => {
                  const url = doc.id ? poDocUrls.get(doc.id) : undefined;
                  if (!doc.id || !url) return null;
                  return <AttachmentPdf key={doc.id} src={url} />;
                })}
            </div>
          </div>
        ) : null}

        {status === "purchased" ||
        status === "on_route" ||
        status === "delivered" ||
        status === "site_purchased" ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            <h2 className="text-ink text-base font-semibold">เอกสาร (ใบส่งของ / ใบเสร็จ)</h2>
            <div className="mt-2 flex flex-col gap-2">
              {invoiceImages.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {invoiceImages.map((doc, idx, arr) => {
                    const url = doc.id ? attachmentUrls.get(doc.id) : undefined;
                    if (!doc.id || !url) return null;
                    /* Spec 50: invoice images form their own lightbox group. */
                    const groupUrls = arr.flatMap((a) =>
                      a.id && attachmentUrls.get(a.id) ? [attachmentUrls.get(a.id) as string] : [],
                    );
                    const groupIndex = arr
                      .slice(0, idx)
                      .filter((a) => a.id && attachmentUrls.get(a.id)).length;
                    return (
                      <li key={doc.id} className="flex flex-col items-center gap-0.5">
                        <span className="border-edge block h-20 w-20 overflow-hidden rounded-lg border">
                          <ZoomablePhoto src={url} group={groupUrls} groupIndex={groupIndex} />
                        </span>
                        {doc.created_by === ctx.id ? (
                          <AttachmentRemoveButton attachmentId={doc.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {/* Spec 121: invoice PDFs render in the iframe viewer. */}
              {invoicePdfs.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {invoicePdfs.map((doc) => {
                    const url = doc.id ? attachmentUrls.get(doc.id) : undefined;
                    if (!doc.id || !url) return null;
                    return (
                      <li key={doc.id} className="flex flex-col gap-0.5">
                        <AttachmentPdf src={url} />
                        {doc.created_by === ctx.id ? (
                          <AttachmentRemoveButton attachmentId={doc.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {invoiceImages.length === 0 && invoicePdfs.length === 0 ? (
                <p className="text-ink-secondary text-xs">ยังไม่มีเอกสาร</p>
              ) : null}
              <InvoiceUploader purchaseRequestId={request.id} projectId={request.project_id} />
            </div>
          </div>
        ) : null}

        {/* Bug 2: proof of payment (สลิปโอน) — its own section + uploader. */}
        {status === "purchased" ||
        status === "on_route" ||
        status === "delivered" ||
        status === "site_purchased" ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            <h2 className="text-ink text-base font-semibold">หลักฐานการชำระเงิน</h2>
            <div className="mt-2 flex flex-col gap-2">
              {paymentImages.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {paymentImages.map((doc, idx, arr) => {
                    const url = doc.id ? attachmentUrls.get(doc.id) : undefined;
                    if (!doc.id || !url) return null;
                    const groupUrls = arr.flatMap((a) =>
                      a.id && attachmentUrls.get(a.id) ? [attachmentUrls.get(a.id) as string] : [],
                    );
                    const groupIndex = arr
                      .slice(0, idx)
                      .filter((a) => a.id && attachmentUrls.get(a.id)).length;
                    return (
                      <li key={doc.id} className="flex flex-col items-center gap-0.5">
                        <span className="border-edge block h-20 w-20 overflow-hidden rounded-lg border">
                          <ZoomablePhoto src={url} group={groupUrls} groupIndex={groupIndex} />
                        </span>
                        {doc.created_by === ctx.id ? (
                          <AttachmentRemoveButton attachmentId={doc.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {paymentPdfs.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {paymentPdfs.map((doc) => {
                    const url = doc.id ? attachmentUrls.get(doc.id) : undefined;
                    if (!doc.id || !url) return null;
                    return (
                      <li key={doc.id} className="flex flex-col gap-0.5">
                        <AttachmentPdf src={url} />
                        {doc.created_by === ctx.id ? (
                          <AttachmentRemoveButton attachmentId={doc.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {paymentImages.length === 0 && paymentPdfs.length === 0 ? (
                <p className="text-ink-secondary text-xs">ยังไม่มีหลักฐานการชำระเงิน</p>
              ) : null}
              <PaymentProofUploader purchaseRequestId={request.id} projectId={request.project_id} />
            </div>
          </div>
        ) : null}

        {hasActions ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            {isDecider && status === "requested" ? (
              <PurchaseRequestDecision requestId={request.id} />
            ) : null}
            {isBackOffice && status === "approved" ? (
              /* Spec 182: compare supplier quotes, then create the PO from the
                 picked one (PriceComparison owns the create-PO sheet, U2). */
              <PriceComparison
                purchaseRequestId={request.id}
                projectId={request.project_id}
                quantity={request.quantity}
                unit={request.unit}
                quotes={quotes}
                suppliers={suppliers}
                history={priceHistory}
                quoteDocs={quoteDocs}
                line={{
                  id: request.id,
                  pr_number: request.pr_number,
                  item_description: request.item_description,
                  quantity: request.quantity,
                  unit: request.unit,
                  wp_code: wp?.code ?? null,
                }}
              />
            ) : null}
            {isBackOffice && status === "purchased" ? (
              <PurchaseRequestShip requestId={request.id} />
            ) : null}
            {isDecider && status === "approved" ? (
              <div className="border-edge-strong mt-3 border-t pt-3">
                <PurchaseRequestCancel requestId={request.id} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}
