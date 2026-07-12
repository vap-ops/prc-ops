// Spec 308 U1 — the delivery receive page: ของเข้า owns receiving end-to-end
// (operator IA directive: จัดซื้อ = orders raised from WPs; ของเข้า = deliveries).
// One arrival, one page — supplier/ETA header, the delivery's PR lines as an
// all-ticked receive checklist (receive_po_lines → the spec-195-P3 trigger
// books the store receipts), a REQUIRED live-camera truck photo set +
// the paper ใบส่งของ/ใบเสร็จ, both landing as delivery-scoped proof
// (purchase_order_attachments purpose='proof_of_delivery', spec 135 —
// procurement's งวด page shows the same gallery). Gate-1 verified live:
// every SA grant already exists (receive_po_lines names site_admin;
// attachment INSERT + storage upload + deliveries/PO SELECT all admit SA).

import { PageShell } from "@/components/features/chrome/page-shell";
import { notFound } from "next/navigation";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { WP_DETAIL_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { isValidUuid } from "@/lib/photos/path";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { incomingHref } from "@/lib/nav/project-paths";
import { planDeliveryReceive } from "@/lib/purchasing/delivery-receive";
import { PoReceiveSection } from "@/components/features/purchasing/po-receive-section";
import { DeliveryProofBlock } from "@/components/features/purchasing/delivery-proof-block";
import { ProofOfDeliveryUploader } from "@/components/features/purchasing/proof-of-delivery-uploader";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PO_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";
import {
  DELIVERY_RECEIVE_PAGE_TITLE,
  TRUCK_PHOTO_REQUIRED_HINT,
  RECEIVED_INTO_STORE_LABEL,
  RECEIVED_INTO_STORE_HINT,
  RECEIPT_PAPER_PROMPT,
  DELIVERY_OVERDUE_FLAG,
  formatThaiDate,
} from "@/lib/i18n/labels";
import { bangkokTodayISO } from "@/lib/work-packages/schedule-today";

interface PageProps {
  params: Promise<{ projectId: string; deliveryId: string }>;
}

export const metadata = { title: DELIVERY_RECEIVE_PAGE_TITLE };

export default async function DeliveryReceivePage({ params }: PageProps) {
  const { projectId, deliveryId } = await params;
  const ctx = await requireRole(WP_DETAIL_ROLES);
  if (!isValidUuid(projectId) || !isValidUuid(deliveryId)) notFound();

  const supabase = await createClient();

  // RLS scopes the viewer; hidden/absent project or delivery 404s alike.
  const [{ data: project }, { data: delivery }] = await Promise.all([
    supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle(),
    supabase
      .from("purchase_order_deliveries")
      .select("id, eta, note, carrier, purchase_order_id")
      .eq("id", deliveryId)
      .maybeSingle(),
  ]);
  if (!project || !delivery) notFound();

  // The delivery's lines — scoped to THIS project so a foreign delivery id
  // can't render another project's items (deliveries read is pool-level).
  const [{ data: lineRows }, { data: po }, { data: proofRows }] = await Promise.all([
    supabase
      .from("purchase_requests")
      .select("id, pr_number, item_description, quantity, unit, status")
      .eq("delivery_id", delivery.id)
      .eq("project_id", project.id)
      .order("pr_number", { ascending: true }),
    supabase
      .from("purchase_orders")
      .select("id, po_number, supplier")
      .eq("id", delivery.purchase_order_id)
      .maybeSingle(),
    supabase
      .from("purchase_order_attachments_current")
      .select("id, kind, storage_path, delivery_id")
      .eq("purchase_order_id", delivery.purchase_order_id)
      .eq("delivery_id", delivery.id)
      .eq("purpose", "proof_of_delivery")
      .order("created_at", { ascending: true }),
  ]);

  const lines = lineRows ?? [];
  if (lines.length === 0) notFound();
  // The current-state view types id nullable — narrow before minting/rendering.
  const proofDocs = (proofRows ?? []).flatMap((d) => (d.id == null ? [] : [{ ...d, id: d.id }]));
  const proofUrls = await mintSignedUrls(PO_ATTACHMENTS_BUCKET, proofDocs);

  // The gate counts PHOTOS only (kind='image') — a paper PDF alone must not
  // satisfy "ถ่ายรูปของที่มาส่ง". (A photographed paper still counts: same
  // purpose stream, no finer discriminator without schema — accepted seam.)
  const plan = planDeliveryReceive({
    lines,
    proofPhotoCount: proofDocs.filter((d) => d.kind === "image").length,
  });
  const today = bangkokTodayISO();
  const overdue = today != null && delivery.eta != null && delivery.eta < today;
  const path = `${incomingHref(project.id)}/${delivery.id}`;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={incomingHref(project.id)} backLabel="กลับไปของเข้า">
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            {DELIVERY_RECEIVE_PAGE_TITLE} — {po?.supplier ?? "ไม่ระบุผู้ขาย"}
          </h1>
        </div>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <div className="text-ink-secondary flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {delivery.eta ? (
            <span className={overdue ? "text-danger font-bold" : undefined}>
              {overdue ? `${DELIVERY_OVERDUE_FLAG} ` : ""}
              {formatThaiDate(delivery.eta)}
            </span>
          ) : null}
          {delivery.carrier ? <span>{delivery.carrier}</span> : null}
          {delivery.note ? <span>{delivery.note}</span> : null}
          <span>
            {lines.length} รายการ
            {plan.receivedCount > 0 ? ` · รับแล้ว ${plan.receivedCount}` : ""}
          </span>
        </div>

        {/* The proof set — truck photos (required before confirm) + the paper
            doc, one delivery-scoped stream shared with procurement's งวด page. */}
        <div className="rounded-card border-edge bg-card shadow-card flex flex-col gap-2 border p-4">
          <DeliveryProofBlock
            purchaseOrderId={delivery.purchase_order_id}
            deliveryId={delivery.id}
            docs={proofDocs}
            urls={proofUrls}
            captureUploader
            uploaderLabel="ถ่ายรูปของที่มาส่ง"
          />
          <div className="border-edge flex flex-col gap-1 border-t pt-2">
            <p className="text-ink-secondary text-xs font-medium">{RECEIPT_PAPER_PROMPT}</p>
            {/* No capture here — a scanned/emailed PDF must attach too (the
                #483 lesson: capture-forced is wrong for document attach). */}
            <ProofOfDeliveryUploader
              purchaseOrderId={delivery.purchase_order_id}
              deliveryId={delivery.id}
              label="แนบใบส่งของ / ใบเสร็จ"
            />
          </div>
        </div>

        {plan.allReceived ? (
          <p className="text-done-strong text-sm font-medium" role="status">
            {RECEIVED_INTO_STORE_LABEL}
            <span className="text-ink-secondary ml-1 text-xs font-normal">
              {RECEIVED_INTO_STORE_HINT}
            </span>
          </p>
        ) : (
          <PoReceiveSection
            lines={plan.receivable.map((l) => ({
              id: l.id,
              pr_number: l.pr_number,
              item_description: l.item_description,
              quantity: l.quantity,
              unit: l.unit,
              amount: null,
            }))}
            backFrom={path}
            {...(plan.photoGateOpen ? {} : { submitBlockedReason: TRUCK_PHOTO_REQUIRED_HINT })}
          />
        )}
      </div>
    </PageShell>
  );
}
