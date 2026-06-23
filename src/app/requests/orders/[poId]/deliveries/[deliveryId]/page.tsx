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
import { isValidUuid } from "@/lib/photos/path";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import {
  PURCHASE_ORDER_STATUS_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import {
  purchaseOrderStatusPillClasses,
  purchaseRequestStatusPillClasses,
} from "@/lib/status-colors";
import { loadDeliveryDetail } from "@/lib/purchasing/load-delivery-detail";
import { DeliveryProofBlock } from "@/components/features/purchasing/delivery-proof-block";
import { DeliveryDispatchControl } from "@/components/features/purchasing/delivery-dispatch-control";
import { poDetailHref } from "@/lib/nav/order-paths";

// /requests/orders/[poId]/deliveries/[deliveryId] — the delivery (งวดจัดส่ง) detail
// screen (spec 135 U5). A PO ships in deliveries procurement arranges; this is where a
// งวด's proof of delivery is attached, so the PO detail's การจัดส่ง section can keep a
// single action (สร้างงวดจัดส่ง). Shows the งวด summary (derived status · eta · cost
// [back-office] · note), its member lines, and the proof gallery + uploader scoped to
// this delivery. Same audience gate as the PO detail (PURCHASING_ROLES); RLS decides
// readability, so an unknown id and a forbidden id both render the Thai 404.

export const metadata = { title: "รายละเอียดงวดจัดส่ง" };

interface PageProps {
  params: Promise<{ poId: string; deliveryId: string }>;
}

export default async function DeliveryDetailPage({ params }: PageProps) {
  const ctx = await requireRole(PURCHASING_ROLES);
  const { poId, deliveryId } = await params;

  if (!isValidUuid(poId) || !isValidUuid(deliveryId)) {
    notFound();
  }

  const supabase = await createClient();
  // Spec 148 U2: one loader batches the delivery-detail reads (was a serial
  // waterfall). Same queries/columns/results — only the scheduling changes.
  const { po, delivery, members, deliveries, proofDocs, proofUrls } = await loadDeliveryDetail(
    supabase,
    poId,
    deliveryId,
  );
  // po and delivery must both exist (an unknown id or another PO's delivery → 404).
  if (!po || !delivery) {
    notFound();
  }

  const view = deliveries.find((d) => d.id === deliveryId);
  const ordinal = view?.ordinal ?? 1;
  const status = view?.status ?? "open";
  const receivedAt = view?.receivedAt ?? null;

  const isBackOffice = isBackOfficeRole(ctx.role);
  const lines = members.filter((m) => m.delivery_id === deliveryId);
  // Spec 135 U6: lines still 'purchased' can be dispatched (→ on_route → in_transit).
  const dispatchableCount = lines.filter((m) => m.status === "purchased").length;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={poDetailHref(poId)} backLabel="กลับไปใบสั่งซื้อ">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink-secondary truncate font-mono text-xs">
              PO-{String(po.po_number).padStart(4, "0")} · {po.supplier}
            </p>
            <h1 className={DETAIL_TITLE}>งวดที่ {ordinal}</h1>
          </div>
          <span className="mt-1 flex shrink-0 flex-col items-end gap-1">
            <StatusPill pillClasses={purchaseOrderStatusPillClasses(status)}>
              {PURCHASE_ORDER_STATUS_LABEL[status]}
            </StatusPill>
          </span>
        </div>
      </DetailHeader>

      <section className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        <div className="rounded-card border-edge bg-card shadow-card border p-4">
          <p className="text-ink text-sm">
            {delivery.eta ? `กำหนดส่ง ${formatThaiDate(delivery.eta)}` : "รอกำหนดส่ง"}
            {receivedAt ? (
              <>
                <span className="text-ink-muted mx-1">·</span>
                รับแล้ว {formatThaiDate(receivedAt)}
              </>
            ) : null}
          </p>
          {isBackOffice && delivery.cost != null ? (
            <p className="text-ink-secondary mt-1 text-xs">ค่าจัดส่ง {baht(delivery.cost)}</p>
          ) : null}
          {delivery.note ? (
            <p className="text-ink-secondary mt-2 text-xs whitespace-pre-wrap">
              หมายเหตุ: {delivery.note}
            </p>
          ) : null}
          {/* Spec 135 U6: dispatch — advance the งวด to กำลังจัดส่ง (back office only). */}
          {isBackOffice && dispatchableCount > 0 ? (
            <div className="border-edge mt-3 border-t pt-3">
              <DeliveryDispatchControl deliveryId={deliveryId} count={dispatchableCount} />
            </div>
          ) : null}
        </div>

        {/* Proof of delivery — the action this page exists for (spec 135 U5). */}
        <div className="rounded-card border-edge bg-card shadow-card border p-4">
          <DeliveryProofBlock
            purchaseOrderId={poId}
            deliveryId={deliveryId}
            docs={proofDocs}
            urls={proofUrls}
          />
        </div>

        <div>
          <h2 className="text-ink mb-3 text-base font-semibold">รายการในงวดนี้</h2>
          <ul className="flex flex-col gap-2">
            {lines.map((m) => (
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
                      <p className="text-ink truncate text-sm font-medium">{m.item_description}</p>
                    </div>
                    <StatusPill pillClasses={purchaseRequestStatusPillClasses(m.status)}>
                      {PURCHASE_REQUEST_STATUS_LABEL[m.status]}
                    </StatusPill>
                  </div>
                  <p className="text-ink-secondary mt-1 text-xs">
                    จำนวน {m.quantity} {m.unit}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          {lines.length === 0 ? (
            <p className="text-ink-secondary text-xs">งวดนี้ยังไม่มีรายการ</p>
          ) : null}
        </div>
      </section>
    </PageShell>
  );
}

// Spec 106 compact THB formatter (mirrors the PO detail).
const baht = (n: number) =>
  `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
