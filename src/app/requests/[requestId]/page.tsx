import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { StatusPill } from "@/components/features/common/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import {
  PURCHASING_ROLES,
  isManagerRole,
  isProcurementManagerTier,
  isPurchaseDecider,
} from "@/lib/auth/role-home";
import { workPackageHref } from "@/lib/nav/project-paths";
import { safeBackHref, withBackFrom } from "@/lib/nav/back-href";
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
  RECEIVED_INTO_STORE_LABEL,
  RECEIVED_INTO_STORE_HINT,
  RECEIPT_PAPER_PROMPT,
  PO_DOCS_FROM_PROCUREMENT_LABEL,
  INVOICE_PAPER_MISSING_LABEL,
  DELIVERY_PHOTO_MISSING_LABEL,
  deliveredQtyCaption,
  WORK_CATEGORY_MATCH_LABEL,
  WORK_CATEGORY_MISMATCH_LABEL,
} from "@/lib/i18n/labels";
import { AlertTriangle, Check } from "lucide-react";
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
import { planRequestDocSections } from "@/lib/purchasing/request-doc-sections";
import { InvoiceDocsDisplay } from "@/components/features/purchasing/invoice-docs-display";
import { WpCategoryCode } from "@/components/features/work-packages/wp-category-code";
import { mintSignedUrlsForAttachments } from "@/lib/purchasing/attachment-signed-urls";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { AttentionCard } from "@/components/features/common/attention-card";
import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import { isReceivedIntoStore } from "@/lib/purchasing/store-receive";
import { PaymentProofUploader } from "@/components/features/purchasing/payment-proof-uploader";
import { AttachmentPdf } from "@/components/features/purchasing/attachment-pdf";
import { SitePurchaseAcknowledge } from "@/components/features/purchasing/site-purchase-acknowledge";

export const metadata = { title: "รายละเอียดคำขอซื้อ" };

interface PageProps {
  params: Promise<{ requestId: string }>;
  // Spec 211 U6b: a request reached from its PO records that path via ?from, so
  // back returns to the order (not the worklist). Falls back to /requests for
  // direct loads / other entry points (see safeBackHref).
  searchParams: Promise<{ from?: string }>;
}

export default async function RequestDetailPage({ params, searchParams }: PageProps) {
  const ctx = await requireRole(PURCHASING_ROLES);
  const { requestId } = await params;
  const { from } = await searchParams;

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
  // Spec 300 U2 / spec 195 P3: a delivered store-bound (WP-less) PR has its stock_receipt
  // auto-booked — tell the SA the goods landed in the store.
  const receivedIntoStore = isReceivedIntoStore(status, request.work_package_id);
  const priority = request.priority;
  const isMine = request.requested_by === ctx.id;

  // isDecider gates the requested→approved/rejected DECISION. Spec 286 (amends
  // ADR 0070 item 3) delegates it to procurement_manager too — via isPurchaseDecider,
  // NOT by widening isManagerRole (which gates /dashboard + money surfaces).
  const isDecider = isPurchaseDecider(ctx.role);
  // Spec 66 / ADR 0043: acknowledging a site purchase stays PM-tier (project-side).
  // Spec 286 widened only the requested→approved/rejected decision to
  // procurement_manager, NOT this ack — keep it on isManagerRole (unchanged).
  const canAckSitePurchase = isManagerRole(ctx.role);
  // Spec 261 / ADR 0070 item 3: cancelling an APPROVED PR is manager-tier PLUS
  // procurement_manager (a separate predicate so it never widens the approve gate;
  // the DB backs this with a transition-scoped approved→cancelled RLS policy).
  const canCancel = isProcurementManagerTier(ctx.role);
  // Spec 261 / ADR 0070: the WP detail route is WP_DETAIL_ROLES-gated, which now
  // admits both procurement and procurement_manager — so the link works for them.
  // The plain-text (non-link) treatment for plain procurement below is a
  // deliberately over-conservative UX choice, not a gate bounce.
  const isProcurement = ctx.role === "procurement";
  // Spec 33 / ADR 0038 gate; suppliers fetched only when the form renders.
  const isBackOffice = isBackOfficeRole(ctx.role);

  // Spec 147 U3: one loader batches the request-detail reads (was a serial
  // waterfall). Same queries/columns/results — only the scheduling changes.
  const {
    wp,
    wpCategoryCode,
    categoryMatch,
    projectName,
    requesterName,
    attachments,
    attachmentUrls,
    poRow,
    poDocs,
    poDocUrls,
    suppliers,
  } = await loadRequestDetail(supabase, request, { isBackOffice });

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

  // Spec 302: the document-section visibility plan — ownership-aware, so the
  // SA's paper-capture job and procurement's paperwork stop reading alike.
  const docPlan = planRequestDocSections({
    status,
    isBackOffice,
    hasPaymentDocs: paymentImages.length > 0 || paymentPdfs.length > 0,
    hasInvoiceDocs: invoiceImages.length > 0 || invoicePdfs.length > 0,
    hasDeliveryPhotos: confirmations.length > 0,
  });

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
    (canCancel && status === "approved");

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 63: the consolidated shell. */}
      <DetailHeader backHref={safeBackHref(from, "/requests")} backLabel="กลับไปจัดซื้อ">
        {/* Spec 301f: name the project — procurement spans projects, and the WP
            line alone doesn't say where this PR belongs. Best-effort: a viewer
            whose RLS can't read the projects row just gets no line. */}
        {projectName ? (
          <p className="text-ink-muted w-fit truncate text-[10px] font-medium">{projectName}</p>
        ) : null}
        {wp ? (
          isProcurement ? (
            <span className="text-ink-secondary w-fit truncate text-xs">
              <WpCategoryCode code={wp.code} categoryCode={wpCategoryCode} />
              <span className="mx-1">·</span>
              {wp.name}
            </span>
          ) : (
            <Link
              href={withBackFrom(workPackageHref(wp.project_id, wp.id), `/requests/${requestId}`)}
              className="text-ink-secondary w-fit truncate text-xs hover:underline focus:outline-none focus-visible:underline"
            >
              <WpCategoryCode code={wp.code} categoryCode={wpCategoryCode} />
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
            {/* Spec 301 U2: the approver-side off-category verdict — the same
                passive flag the picker showed at pick time (spec 297), recomputed
                here where the approve/PO decision happens. Never blocks. */}
            {categoryMatch === "match" ? (
              <p className="text-done-strong mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium">
                <Check aria-hidden className="size-3.5" /> {WORK_CATEGORY_MATCH_LABEL}
              </p>
            ) : categoryMatch === "mismatch" ? (
              <p className="text-attn-press mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium">
                <AlertTriangle aria-hidden className="size-3.5" /> {WORK_CATEGORY_MISMATCH_LABEL}
              </p>
            ) : null}
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
            {canAckSitePurchase ? (
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
              {/* Spec 303: photo-less delivered = no receive proof (the BO
                  checklist path can produce this) — amber, every role. */}
              {docPlan.deliveryPhotoMissingFlag ? (
                <p className="text-attn-ink text-xs font-medium">{DELIVERY_PHOTO_MISSING_LABEL}</p>
              ) : null}
              {confirmations.length > 0 ? (
                <div>
                  <p className="text-ink-secondary text-xs font-medium">
                    รูปยืนยันการรับของ
                    {/* Spec 303: the photos↔amount pairing, per PR row (แบ่งรับ
                        splits are separate rows, so this is per-event exact). */}
                    {status === "delivered" ? (
                      <span className="text-ink-muted font-normal">
                        {" · "}
                        {deliveredQtyCaption(request.quantity, request.unit)}
                      </span>
                    ) : null}
                  </p>
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
              {receivedIntoStore ? (
                <p className="text-done-strong text-xs font-medium" role="status">
                  {RECEIVED_INTO_STORE_LABEL}
                  <span className="text-ink-secondary ml-1 font-normal">
                    {RECEIVED_INTO_STORE_HINT}
                  </span>
                </p>
              ) : null}
              <DeliveryPhotoUploader
                purchaseRequestId={request.id}
                projectId={request.project_id}
                userId={ctx.id}
              />
              {/* Spec 300 U2 + 302: capture the paper receipt (ใบส่งของ/ใบเสร็จ) at the
                  receive moment — uploads now display right here too, so the SA's
                  paper job lives in ONE card (the standalone เอกสาร card is gone at
                  these statuses). */}
              <div className="border-edge flex flex-col gap-2 border-t pt-2">
                <p className="text-ink-secondary text-xs font-medium">{RECEIPT_PAPER_PROMPT}</p>
                {docPlan.invoiceDocsInReceiveCard ? (
                  <InvoiceDocsDisplay
                    images={invoiceImages}
                    pdfs={invoicePdfs}
                    urls={attachmentUrls}
                    viewerId={ctx.id}
                  />
                ) : null}
                {docPlan.invoiceMissingFlag ? (
                  <p className="text-attn-ink text-xs font-medium">{INVOICE_PAPER_MISSING_LABEL}</p>
                ) : null}
                <InvoiceUploader purchaseRequestId={request.id} projectId={request.project_id} />
              </div>
            </div>
          </div>
        ) : null}

        {poDocs.length > 0 && docPlan.showPoDocsSection ? (
          /* Spec 302/304: procurement's PO paperwork — back-office only now
             (spec 304 asymmetry), collapsed out of the action path. */
          <details className="rounded-card border-edge bg-card shadow-card border p-4">
            <summary className="cursor-pointer">
              <h2 className="text-ink inline text-base font-semibold">
                {PO_DOCS_FROM_PROCUREMENT_LABEL}
              </h2>
            </summary>
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
          </details>
        ) : null}

        {/* Spec 302: at on_route/delivered this whole card folds into the การรับของ
            card above (docPlan) — no second "ยังไม่มีเอกสาร" task for the SA. It
            remains for the pre-delivery states (purchased/site_purchased). */}
        {(status === "purchased" || status === "site_purchased") &&
        docPlan.showStandaloneInvoiceCard ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            <h2 className="text-ink text-base font-semibold">เอกสาร (ใบส่งของ / ใบเสร็จ)</h2>
            <div className="mt-2 flex flex-col gap-2">
              <InvoiceDocsDisplay
                images={invoiceImages}
                pdfs={invoicePdfs}
                urls={attachmentUrls}
                viewerId={ctx.id}
              />
              {invoiceImages.length === 0 && invoicePdfs.length === 0 ? (
                <p className="text-ink-secondary text-xs">ยังไม่มีเอกสาร</p>
              ) : null}
              <InvoiceUploader purchaseRequestId={request.id} projectId={request.project_id} />
            </div>
          </div>
        ) : null}

        {/* Bug 2 + spec 302/304: proof of payment (สลิปโอน) is the BUYER's document.
            Back-office (and site-purchase, where the SA paid) get the uploader;
            everyone else gets NOTHING — procurement's docs are not the SA's
            concern (spec 304 asymmetry). */}
        {(status === "purchased" ||
          status === "on_route" ||
          status === "delivered" ||
          status === "site_purchased") &&
        docPlan.paymentSection === "uploader" ? (
          <div className="rounded-card border-edge bg-card shadow-card border p-4">
            <h2 className="text-ink text-base font-semibold">หลักฐานการชำระเงิน</h2>
            <div className="mt-2 flex flex-col gap-2">
              <InvoiceDocsDisplay
                images={paymentImages}
                pdfs={paymentPdfs}
                urls={attachmentUrls}
                viewerId={ctx.id}
              />
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
                  wp_category_code: wpCategoryCode,
                }}
              />
            ) : null}
            {isBackOffice && status === "purchased" ? (
              <PurchaseRequestShip requestId={request.id} />
            ) : null}
            {canCancel && status === "approved" ? (
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
