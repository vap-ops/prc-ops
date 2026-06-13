import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { StatusPill } from "@/components/features/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASING_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { isValidUuid } from "@/lib/photos/path";
import { PR_LIST_COLUMNS } from "@/lib/purchasing/columns";
import { DETAIL_TITLE } from "@/lib/ui/classes";

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
import { PurchaseRequestTracker } from "@/components/features/purchase-request-tracker";
import { PurchaseRequestDecision } from "@/components/features/purchase-request-decision";
import { PurchaseRequestCancel } from "@/components/features/purchase-request-cancel";
import {
  PurchaseRecordForm,
  type SupplierOption,
} from "@/components/features/purchase-record-form";
import { PurchaseRequestShip } from "@/components/features/purchase-request-ship";
import { isBackOfficeRole } from "@/lib/purchasing/back-office";
import { DeliveryPhotoUploader } from "@/components/features/delivery-photo-uploader";
import { PurchaseRequestAttachmentStager } from "@/components/features/purchase-request-attachment-stager";
import { AttachmentRemoveButton } from "@/components/features/attachment-remove-button";
import { ZoomablePhoto } from "@/components/features/photo-lightbox";
import { mintSignedUrlsForAttachments } from "@/lib/purchasing/attachment-signed-urls";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { DetailHeader } from "@/components/features/detail-header";
import { AttentionCard } from "@/components/features/attention-card";
import { InvoiceUploader } from "@/components/features/invoice-uploader";
import { SitePurchaseAcknowledge } from "@/components/features/site-purchase-acknowledge";

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
    .select(`${PR_LIST_COLUMNS}, notes, source, acknowledged_at`)
    .eq("id", requestId)
    .maybeSingle();

  if (!request) {
    notFound();
  }

  const status = request.status;
  const priority = request.priority;
  const isMine = request.requested_by === ctx.id;

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, project_id")
    .eq("id", request.work_package_id)
    .maybeSingle();

  const requesterNames = await fetchDisplayNames(
    request.requested_by ? [request.requested_by] : [],
    "[requests/detail]",
  );
  const requesterName =
    (request.requested_by ? requesterNames.get(request.requested_by) : null) ??
    request.requested_by_email ??
    "—";

  // Attachments (spec 23 + spec 16 P2): the current-state view
  // (ADR 0009/0015 anti-join pre-encoded), one request's rows, split by
  // purpose/kind, then batched signed URLs for the image rows.
  const { data: attachmentRows } = await supabase
    .from("purchase_request_attachments_current")
    .select("id, purchase_request_id, kind, purpose, storage_path, url, created_by, created_at")
    .eq("purchase_request_id", request.id)
    .order("created_at", { ascending: true });
  const attachments = attachmentRows ?? [];
  const confirmations = attachments.filter((row) => row.purpose === "delivery_confirmation");
  // Spec 66 / ADR 0043: invoices (ใบส่งของ/ใบเสร็จ) are their own purpose —
  // split out so they don't leak into the reference section.
  const invoices = attachments.filter((row) => row.purpose === "invoice");
  const referenceImages = attachments.filter(
    (row) => row.purpose === "reference" && row.kind === "image",
  );
  const referenceLinks = attachments.filter(
    (row) => row.purpose === "reference" && row.kind !== "image",
  );
  const attachmentUrls = await mintSignedUrlsForAttachments(
    attachments
      .filter((row) => row.kind === "image")
      .map((row) => ({ id: row.id ?? "", storage_path: row.storage_path })),
  );

  const isDecider = ctx.role === "project_manager" || ctx.role === "super_admin";
  // Spec 70: the WP detail route (/sa/...) is SITE_STAFF_ROLES-gated and would
  // bounce procurement, so the WP reference renders as plain text (not a link)
  // for it. Every other role keeps the link.
  const isProcurement = ctx.role === "procurement";
  // Spec 33 / ADR 0038 gate; suppliers fetched only when the form renders.
  const isBackOffice = isBackOfficeRole(ctx.role);
  // Spec 66 / ADR 0043: on-site purchase + PM-ack state (badge derives
  // from source + acknowledged_at, not a status change).
  const isSitePurchase = request.source === "site_purchase";
  const ackAt = request.acknowledged_at;
  let suppliers: SupplierOption[] = [];
  if (isBackOffice && status === "approved") {
    const { data: supplierRows } = await supabase
      .from("suppliers")
      .select("id, name, phone")
      .order("name", { ascending: true });
    suppliers = supplierRows ?? [];
  }

  const hasActions =
    (isDecider && status === "requested") ||
    (isBackOffice && status === "approved") ||
    (isBackOffice && status === "purchased") ||
    (isDecider && status === "approved");

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 63: the consolidated shell. */}
      <DetailHeader backHref="/requests" backLabel="กลับไปคำขอซื้อ">
        {wp ? (
          isProcurement ? (
            <span className="w-fit truncate text-xs text-zinc-600">
              <span className="font-mono">{wp.code}</span>
              <span className="mx-1">·</span>
              {wp.name}
            </span>
          ) : (
            <Link
              href={`/sa/projects/${wp.project_id}/work-packages/${wp.id}`}
              className="w-fit truncate text-xs text-zinc-600 hover:underline focus:outline-none focus-visible:underline"
            >
              <span className="font-mono">{wp.code}</span>
              <span className="mx-1">·</span>
              {wp.name}
            </Link>
          )
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-zinc-600">
              PR-{String(request.pr_number).padStart(4, "0")}
            </p>
            {/* Spec 57: the page's subject never truncates. */}
            <h1 className={DETAIL_TITLE}>{request.item_description}</h1>
          </div>
          <span className="mt-1 flex shrink-0 flex-col items-end gap-1">
            <StatusPill pillClasses={purchaseRequestStatusPillClasses(status)}>
              {PURCHASE_REQUEST_STATUS_LABEL[status]}
            </StatusPill>
            {priority !== "normal" ? (
              <StatusPill pillClasses={purchaseRequestPriorityPillClasses(priority)}>
                {PURCHASE_REQUEST_PRIORITY_LABEL[priority]}
              </StatusPill>
            ) : null}
          </span>
        </div>
      </DetailHeader>

      <section className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-zinc-900">
            จำนวน {request.quantity} {request.unit}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {isMine ? (
              <span className="mr-1.5 inline-flex items-center rounded-full border border-blue-700 bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700">
                ของฉัน
              </span>
            ) : null}
            ขอซื้อโดย {requesterName}
            <span className="mx-1 text-zinc-400">·</span>
            ขอเมื่อ {formatThaiDate(request.requested_at)}
          </p>
          {request.needed_by ? (
            <p className="mt-1 text-xs text-zinc-600">
              ต้องการรับของภายใน {formatThaiDate(request.needed_by)}
            </p>
          ) : null}
          {request.notes ? (
            /* Spec 48: requester note — write-once at creation. */
            <p className="mt-1 text-xs whitespace-pre-wrap text-zinc-600">
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
                  <p className="mt-1 text-xs text-zinc-600">
                    พิจารณาเมื่อ {formatThaiDateTime(request.decided_at)}
                  </p>
                ) : null}
              </AttentionCard>
            </div>
          ) : null}
          {request.supplier || (status === "delivered" && request.received_by) ? (
            <p className="mt-3 text-xs text-zinc-600">
              {request.supplier ? `ผู้ขาย ${request.supplier}` : ""}
              {request.supplier && status === "delivered" && request.received_by ? " · " : ""}
              {status === "delivered" && request.received_by
                ? `ผู้รับของ ${request.received_by}`
                : ""}
            </p>
          ) : null}
          {status === "delivered" && request.delivery_note ? (
            <p className="mt-1 text-xs whitespace-pre-wrap text-zinc-600">
              {request.delivery_note}
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
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-emerald-700">
              PM รับทราบการซื้อหน้างานแล้ว · {formatThaiDateTime(ackAt)}
            </p>
          </div>
        ) : null}

        {referenceImages.length > 0 ||
        referenceLinks.length > 0 ||
        (status === "requested" && isMine && wp) ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">เอกสารอ้างอิง</h2>
            {referenceImages.length > 0 ? (
              <div className="mt-2">
                <p className="text-xs font-medium text-zinc-700">รูปอ้างอิง</p>
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
                        <span className="block h-20 w-20 overflow-hidden rounded-lg border border-zinc-200">
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
            {referenceLinks.length > 0 ? (
              <div className="mt-2">
                <p className="text-xs font-medium text-zinc-700">ลิงก์อ้างอิง</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {referenceLinks.map((link) => {
                    if (!link.id || !link.url) return null;
                    return (
                      <li key={link.id} className="flex items-center gap-2">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="min-w-0 flex-1 truncate text-xs text-blue-700 underline-offset-2 hover:underline"
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
            {status === "requested" && isMine && wp ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-blue-700 underline-offset-2 hover:underline">
                  เพิ่มรูปหรือลิงก์
                </summary>
                <div className="mt-2">
                  <PurchaseRequestAttachmentStager
                    projectId={wp.project_id}
                    purchaseRequestId={request.id}
                    userId={ctx.id}
                  />
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {status === "delivered" || status === "on_route" ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">การรับของ</h2>
            <div className="mt-2 flex flex-col gap-2">
              {confirmations.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-zinc-700">รูปยืนยันการรับของ</p>
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
                          <span className="block h-20 w-20 overflow-hidden rounded-lg border border-zinc-200">
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
              {wp ? (
                <DeliveryPhotoUploader
                  purchaseRequestId={request.id}
                  projectId={wp.project_id}
                  userId={ctx.id}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {status === "purchased" ||
        status === "on_route" ||
        status === "delivered" ||
        status === "site_purchased" ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-zinc-900">เอกสาร (ใบส่งของ / ใบเสร็จ)</h2>
            <div className="mt-2 flex flex-col gap-2">
              {invoices.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {invoices.map((doc, idx, arr) => {
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
                        <span className="block h-20 w-20 overflow-hidden rounded-lg border border-zinc-200">
                          <ZoomablePhoto src={url} group={groupUrls} groupIndex={groupIndex} />
                        </span>
                        {doc.created_by === ctx.id ? (
                          <AttachmentRemoveButton attachmentId={doc.id} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-zinc-600">ยังไม่มีเอกสาร</p>
              )}
              {wp ? (
                <InvoiceUploader purchaseRequestId={request.id} projectId={wp.project_id} />
              ) : null}
            </div>
          </div>
        ) : null}

        {hasActions ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            {isDecider && status === "requested" ? (
              <PurchaseRequestDecision requestId={request.id} />
            ) : null}
            {isBackOffice && status === "approved" ? (
              /* Spec 33: in-app purchase recording — parallel path to
                 AppSheet (ADR 0034 amendment). */
              <PurchaseRecordForm requestId={request.id} suppliers={suppliers} />
            ) : null}
            {isBackOffice && status === "purchased" ? (
              <PurchaseRequestShip requestId={request.id} />
            ) : null}
            {isDecider && status === "approved" ? (
              <div className="mt-3 border-t border-zinc-300 pt-3">
                <PurchaseRequestCancel requestId={request.id} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}
