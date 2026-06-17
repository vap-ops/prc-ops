import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { StatusPill } from "@/components/features/common/status-pill";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { PURCHASING_ROLES } from "@/lib/auth/role-home";
import { isBackOfficeRole } from "@/lib/purchasing/back-office";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { isValidUuid } from "@/lib/photos/path";
import { PR_LIST_COLUMNS } from "@/lib/purchasing/columns";
import { buildPoDetailView } from "@/lib/purchasing/po-detail";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import {
  PURCHASE_ORDER_STATUS_LABEL,
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  formatThaiDate,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import {
  purchaseOrderStatusPillClasses,
  purchaseRequestPriorityPillClasses,
  purchaseRequestStatusPillClasses,
} from "@/lib/status-colors";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PO_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { AttachmentPdf } from "@/components/features/purchasing/attachment-pdf";
import { ProofOfDeliveryUploader } from "@/components/features/purchasing/proof-of-delivery-uploader";

// /requests/orders/[poId] — the purchase-order detail screen (spec 134 U1). A PO
// groups N approved tickets into one supplier order (ADR 0044); spec 115 shipped
// the data layer with the status/total DERIVED from the member tickets. This is
// the first screen that views a PO as a unit — a drill-down UNDER the purchasing
// surface (no new primary tab; operator decision), reached from a member ticket
// and (spec 134 U2) from the worklist. Same audience gate as /requests
// (PURCHASING_ROLES); RLS on purchase_orders decides readability, so an unknown id
// and a forbidden id both render the Thai 404 — the /requests convention.
//
// MONEY POSTURE (spec 106 / ADR 0038): per-line amount + the PO total are money —
// read ONLY via the admin client and shown ONLY to back office (pm/procurement/
// super, NOT site_admin). The derived STATUS needs no money, so site_admin still
// sees the roll-up and the line list.

export const metadata = { title: "รายละเอียดใบสั่งซื้อ" };

interface PageProps {
  params: Promise<{ poId: string }>;
}

export default async function PurchaseOrderDetailPage({ params }: PageProps) {
  const ctx = await requireRole(PURCHASING_ROLES);
  const { poId } = await params;

  // Non-UUID params skip the query (the /requests/[requestId] convention):
  // "garbage", "unknown", and "not allowed" are deliberately indistinguishable.
  if (!isValidUuid(poId)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("id, po_number, supplier, supplier_id, eta, ordered_at, notes")
    .eq("id", poId)
    .maybeSingle();

  if (!po) {
    notFound();
  }

  // Member tickets (the source of truth for status + total). Read the same fact
  // columns the list/detail read (spec 65), ordered by their running number.
  const { data: memberRows } = await supabase
    .from("purchase_requests")
    .select(PR_LIST_COLUMNS)
    .eq("purchase_order_id", poId)
    .order("pr_number", { ascending: true });
  const members = memberRows ?? [];

  // WP code/name for each line's chip (separate query, the /requests convention).
  const wpIds = Array.from(new Set(members.map((m) => m.work_package_id)));
  const { data: wpRows } = wpIds.length
    ? await supabase.from("work_packages").select("id, code, name, project_id").in("id", wpIds)
    : { data: [] };
  const wpById = new Map((wpRows ?? []).map((wp) => [wp.id, wp]));

  // Money: per-line amount via the admin client, gated to back office (spec 106).
  const isBackOffice = isBackOfficeRole(ctx.role);
  const amountById = new Map<string, number | null>();
  if (isBackOffice && members.length > 0) {
    const admin = createAdminSupabase();
    const { data: amountRows } = await admin
      .from("purchase_requests")
      .select("id, amount")
      .in(
        "id",
        members.map((m) => m.id),
      );
    for (const a of amountRows ?? []) amountById.set(a.id, a.amount);
  }

  // Derived roll-up: status from every member, total + active count excluding
  // rejected/cancelled (ADR 0044 §5; buildPoDetailView pins this).
  const view = buildPoDetailView(
    members.map((m) => ({ status: m.status, amount: amountById.get(m.id) ?? null })),
  );

  // Spec 134 U4a: manual proof-of-delivery attachments live in the po-attachments
  // bucket stamped purpose 'proof_of_delivery' (distinct from the source docs).
  // Read the current-state rows + mint signed URLs (private bucket, service-role).
  const { data: proofRows } = await supabase
    .from("purchase_order_attachments_current")
    .select("id, kind, storage_path, created_at")
    .eq("purchase_order_id", poId)
    .eq("purpose", "proof_of_delivery")
    .order("created_at", { ascending: true });
  const proofDocs = proofRows ?? [];
  const proofUrls = await mintSignedUrls(
    PO_ATTACHMENTS_BUCKET,
    proofDocs.map((row) => ({ id: row.id ?? "", storage_path: row.storage_path })),
  );
  const proofImages = proofDocs.filter((d) => d.kind === "image");

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/requests" backLabel="กลับไปคำขอซื้อ">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink-secondary font-mono text-xs">
              PO-{String(po.po_number).padStart(4, "0")}
            </p>
            <h1 className={DETAIL_TITLE}>{po.supplier}</h1>
          </div>
          <span className="mt-1 flex shrink-0 flex-col items-end gap-1">
            <StatusPill pillClasses={purchaseOrderStatusPillClasses(view.status)}>
              {PURCHASE_ORDER_STATUS_LABEL[view.status]}
            </StatusPill>
          </span>
        </div>
      </DetailHeader>

      <section className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        <div className="rounded-card border-edge bg-card shadow-card border p-4">
          <p className="text-ink text-sm">
            {view.activeLineCount} รายการในใบสั่งซื้อ
            {isBackOffice ? (
              <>
                <span className="text-ink-muted mx-1">·</span>
                รวม {baht(view.total)}
              </>
            ) : null}
          </p>
          {po.ordered_at ? (
            <p className="text-ink-secondary mt-1 text-xs">
              สั่งซื้อเมื่อ {formatThaiDateTime(po.ordered_at)}
            </p>
          ) : null}
          {po.eta ? (
            <p className="text-ink-secondary mt-1 text-xs">กำหนดรับของ {formatThaiDate(po.eta)}</p>
          ) : null}
          {po.notes ? (
            <p className="text-ink-secondary mt-2 text-xs whitespace-pre-wrap">
              หมายเหตุ: {po.notes}
            </p>
          ) : null}
        </div>

        <div>
          <h2 className="text-ink mb-3 text-base font-semibold">รายการในใบสั่งซื้อ</h2>
          <ul className="flex flex-col gap-2">
            {members.map((m) => {
              const wp = wpById.get(m.work_package_id);
              const amount = amountById.get(m.id) ?? null;
              return (
                <li key={m.id}>
                  <Link
                    href={`/requests/${m.id}`}
                    className="rounded-card border-edge bg-card shadow-card hover:bg-sunk focus-visible:ring-action block border p-3 transition-colors focus:outline-none focus-visible:ring-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink-secondary font-mono text-xs">
                          PR-{String(m.pr_number).padStart(4, "0")}
                        </p>
                        <p className="text-ink truncate text-sm font-medium">
                          {m.item_description}
                        </p>
                      </div>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusPill pillClasses={purchaseRequestStatusPillClasses(m.status)}>
                          {PURCHASE_REQUEST_STATUS_LABEL[m.status]}
                        </StatusPill>
                        {m.priority !== "normal" ? (
                          <StatusPill pillClasses={purchaseRequestPriorityPillClasses(m.priority)}>
                            {PURCHASE_REQUEST_PRIORITY_LABEL[m.priority]}
                          </StatusPill>
                        ) : null}
                      </span>
                    </div>
                    <p className="text-ink-secondary mt-1 text-xs">
                      จำนวน {m.quantity} {m.unit}
                      {isBackOffice && amount != null ? (
                        <>
                          <span className="text-ink-muted mx-1">·</span>
                          {baht(amount)}
                        </>
                      ) : null}
                    </p>
                    {wp ? (
                      <p className="text-ink-secondary mt-1 truncate text-xs">
                        <span className="font-mono">{wp.code}</span>
                        <span className="mx-1">·</span>
                        {wp.name}
                      </p>
                    ) : null}
                  </Link>
                  {/* The WP deep-link is on the ticket detail; procurement is
                      bounced from the WP screen (spec 70), so the chip stays
                      plain text here for every role — the row already links to
                      the ticket. */}
                </li>
              );
            })}
          </ul>
          {members.length === 0 ? (
            <p className="text-ink-secondary text-xs">ใบสั่งซื้อนี้ยังไม่มีรายการ</p>
          ) : null}
        </div>

        {/* Spec 134 U4a: manual proof-of-delivery — a signed delivery note / photo
            of the received goods, attached at the PO level. Its own section,
            distinct from the source documents (ใบเสนอราคา/ใบแจ้งหนี้). */}
        <div className="rounded-card border-edge bg-card shadow-card border p-4">
          <h2 className="text-ink text-base font-semibold">หลักฐานการรับของ</h2>
          <div className="mt-2 flex flex-col gap-2">
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
            {proofDocs
              .filter((d) => d.kind === "pdf")
              .map((doc) => {
                const url = doc.id ? proofUrls.get(doc.id) : undefined;
                if (!doc.id || !url) return null;
                return <AttachmentPdf key={doc.id} src={url} />;
              })}
            {proofDocs.length === 0 ? (
              <p className="text-ink-secondary text-xs">ยังไม่มีหลักฐานการรับของ</p>
            ) : null}
            <ProofOfDeliveryUploader purchaseOrderId={po.id} />
          </div>
        </div>
      </section>
    </PageShell>
  );
}

// Spec 106 compact THB formatter (mirrors /requests).
const baht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;
