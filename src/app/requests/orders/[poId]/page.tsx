import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bahtWithSymbol as baht } from "@/lib/format";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { StatusPill } from "@/components/features/common/status-pill";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { PO_DETAIL_VIEW_ROLES, RECEIVE_ROLES } from "@/lib/auth/role-home";
import { isBackOfficeRole } from "@/lib/purchasing/back-office";
import { createClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { isValidUuid } from "@/lib/photos/path";
import { buildPoDetailView } from "@/lib/purchasing/po-detail";
import { loadPurchaseOrderDetail } from "@/lib/purchasing/load-po-detail";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import {
  PURCHASE_ORDER_STATUS_LABEL,
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import {
  purchaseOrderStatusPillClasses,
  purchaseRequestPriorityPillClasses,
  purchaseRequestStatusPillClasses,
} from "@/lib/status-colors";
import {
  purchaseOrderStatusIcon,
  purchaseRequestPriorityIcon,
  purchaseRequestStatusIcon,
} from "@/lib/status-icons";
import { PoReceiveSection } from "@/components/features/purchasing/po-receive-section";
import { VoidPurchaseOrderButton } from "@/components/features/purchasing/void-purchase-order-button";
import { PoChargesSection } from "@/components/features/purchasing/po-charges-section";
import { canVoidPurchaseOrder } from "@/lib/purchasing/purchase-order";
import { isManagerRole } from "@/lib/auth/role-home";
import { PurchaseOrderTracker } from "@/components/features/purchasing/purchase-order-tracker";
import { PoDeliveriesTracker } from "@/components/features/purchasing/po-deliveries-tracker";
import { PoDeliverySection } from "@/components/features/purchasing/po-delivery-section";
import { buildDeliveriesView } from "@/lib/purchasing/po-deliveries";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import { PoBreadcrumb } from "@/components/features/purchasing/po-breadcrumb";
import { safeBackHref, withBackFrom } from "@/lib/nav/back-href";

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
  // Spec 211 U9b: a PO reached from an accounting voucher records that path via
  // ?from, so back returns to the voucher (not the /requests worklist, which
  // accounting can't open). Falls back to /requests for the procurement entries.
  searchParams: Promise<{ from?: string }>;
}

export default async function PurchaseOrderDetailPage({ params, searchParams }: PageProps) {
  const ctx = await requireRole(PO_DETAIL_VIEW_ROLES);
  const { poId } = await params;
  const { from } = await searchParams;

  // Non-UUID params skip the query (the /requests/[requestId] convention):
  // "garbage", "unknown", and "not allowed" are deliberately indistinguishable.
  if (!isValidUuid(poId)) {
    notFound();
  }

  // Spec 211 U9b: accounting opens this read-only (the voucher → PO link). It reads
  // the PO via the admin client (its org-wide money posture, like the voucher/
  // register) since RLS doesn't grant it purchase tables; purchasing roles keep the
  // RLS client (membership-scoped). Money is shown to accounting (the money role);
  // the write actions (manage/receive) stay gated out below.
  const isAccounting = ctx.role === "accounting";
  const supabase = isAccounting ? createAdminClient() : await createClient();
  const isBackOffice = isBackOfficeRole(ctx.role);
  const canSeeMoney = isBackOffice || isAccounting;
  // Spec 208 Q3 (reverses spec 134 U8 / feedback 6fbcc039): receiving is a site
  // action PLUS procurement — the off-site team may confirm arrival on the site's
  // behalf when site staff are short. Mirrors the widened receive_po_lines gate.
  const canReceive = RECEIVE_ROLES.includes(ctx.role);

  // Spec 148 U1: one loader batches the PO-detail reads (was a serial waterfall).
  // Same queries/columns/results — only the scheduling changes. Per-line amount
  // (money) stays admin-client + back-office-only (spec 106), inside the loader.
  const { po, members, deliveryRows, wpById, amountById, charges } = await loadPurchaseOrderDetail(
    supabase,
    poId,
    { isBackOffice: canSeeMoney },
  );

  if (!po) {
    notFound();
  }

  // Derived roll-up: status from every member, total + active count excluding
  // rejected/cancelled (ADR 0044 §5; buildPoDetailView pins this). Spec 260: the
  // total is the charges-aware GRAND total (line sum + transport/other − discount).
  const view = buildPoDetailView(
    members.map((m) => ({ status: m.status, amount: amountById.get(m.id) ?? null })),
    charges.map((c) => ({ charge_type: c.charge_type, amount: c.amount })),
  );

  // Spec 134 U5: the in-transit lines feed the รับของ checklist (all ticked by
  // default — Case A; untick to wait — Case B). Back office sees the per-line amount
  // (used by the within-ticket split prefill); others get null (money posture).
  const inTransitLines = members
    .filter((m) => m.status === "purchased" || m.status === "on_route")
    .map((m) => ({
      id: m.id,
      pr_number: m.pr_number,
      item_description: m.item_description,
      quantity: m.quantity,
      unit: m.unit,
      amount: isBackOffice ? (amountById.get(m.id) ?? null) : null,
    }));

  // Spec 135 U2: the deliveries view — งวดที่ N, derived status, eta, receipt date.
  // One delivery (the 85% default) renders as a calm line; multiple as the งวดส่ง list.
  const deliveries = buildDeliveriesView(
    deliveryRows ?? [],
    members.map((m) => ({
      delivery_id: m.delivery_id,
      status: m.status,
      delivered_at: m.delivered_at,
    })),
  );

  // Spec 135 U3: procurement (back office) splits the PO into more deliveries. Only
  // in-transit lines may move; the non-empty guard needs each delivery's active
  // (non rejected/cancelled) line count. Site never creates (no money, no plan).
  const splittableLines = members
    .filter((m) => m.status === "purchased" || m.status === "on_route")
    .map((m) => ({
      id: m.id,
      pr_number: m.pr_number,
      item_description: m.item_description,
      delivery_id: m.delivery_id,
    }));
  const activeCountByDelivery: Record<string, number> = {};
  for (const m of members) {
    if (m.status === "rejected" || m.status === "cancelled" || m.delivery_id == null) continue;
    activeCountByDelivery[m.delivery_id] = (activeCountByDelivery[m.delivery_id] ?? 0) + 1;
  }

  // Spec 259: revert a mistakenly-created PO — only while nothing has
  // shipped (mirrors void_purchase_order's own guard; the RPC re-checks
  // regardless). Same back-office gate as the delivery-management section.
  const canVoid = isBackOffice && canVoidPurchaseOrder(members.map((m) => m.status));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/requests")} backLabel="กลับไปจัดซื้อ">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <PoBreadcrumb poNumber={po.po_number} />
            <h1 className={`${DETAIL_TITLE} mt-0.5`}>{po.supplier}</h1>
          </div>
          <span className="mt-1 flex shrink-0 flex-col items-end gap-1">
            <StatusPill
              pillClasses={purchaseOrderStatusPillClasses(view.status)}
              icon={purchaseOrderStatusIcon(view.status)}
            >
              {PURCHASE_ORDER_STATUS_LABEL[view.status]}
            </StatusPill>
          </span>
        </div>
      </DetailHeader>

      <section className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        {canVoid ? (
          <div className="flex justify-end">
            <VoidPurchaseOrderButton purchaseOrderId={po.id} poNumber={po.po_number} />
          </div>
        ) : null}

        <div className="rounded-card border-edge bg-card shadow-card border p-4">
          <p className="text-ink text-sm">
            {view.activeLineCount} รายการในใบสั่งซื้อ
            {canSeeMoney ? (
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
          {po.notes ? (
            <p className="text-ink-secondary mt-2 text-xs whitespace-pre-wrap">
              หมายเหตุ: {po.notes}
            </p>
          ) : null}
          {/* Spec 134 U6: the PO progress stepper — สั่งซื้อ → จัดส่ง → รับของ. Spec 135
              U6: a multi-delivery PO branches into a per-งวด stepper; one delivery keeps
              the single rolled-up tracker. */}
          <div className="border-edge-strong mt-3 border-t pt-3">
            {deliveries.length > 1 ? (
              <PoDeliveriesTracker deliveries={deliveries} />
            ) : (
              <PurchaseOrderTracker status={view.status} />
            )}
          </div>
        </div>

        {/* Spec 135 U2: the การจัดส่ง block — the deliveries (งวดส่ง) procurement
            arranges + the delivery proof. One delivery = a calm line; many = the list. */}
        <PoDeliverySection
          purchaseOrderId={po.id}
          deliveries={deliveries}
          canManageDeliveries={isBackOffice}
          splittableLines={splittableLines}
          activeCountByDelivery={activeCountByDelivery}
        />

        {/* Spec 134 U5 + spec 208 Q3: the receive checklist — site staff PLUS
            procurement (the off-site team may confirm arrival on the site's behalf). */}
        {inTransitLines.length > 0 && canReceive ? (
          <PoReceiveSection lines={inTransitLines} />
        ) : null}

        <div>
          <h2 className="text-ink mb-3 text-base font-semibold">รายการในใบสั่งซื้อ</h2>
          <ul className="flex flex-col gap-2">
            {members.map((m) => {
              const wp = m.work_package_id ? wpById.get(m.work_package_id) : undefined;
              const amount = amountById.get(m.id) ?? null;
              return (
                <li key={m.id}>
                  <Link
                    href={withBackFrom(`/requests/${m.id}`, `/requests/orders/${po.id}`)}
                    className="rounded-card border-edge bg-card shadow-card hover:bg-sunk focus-visible:ring-action block border p-3 transition-colors focus:outline-none focus-visible:ring-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-ink-secondary font-mono text-xs">
                          {formatPrNumber(m.pr_number)}
                        </p>
                        <p className="text-ink truncate text-sm font-medium">
                          {m.item_description}
                        </p>
                      </div>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusPill
                          pillClasses={purchaseRequestStatusPillClasses(m.status)}
                          icon={purchaseRequestStatusIcon(m.status)}
                        >
                          {PURCHASE_REQUEST_STATUS_LABEL[m.status]}
                        </StatusPill>
                        {m.priority !== "normal" ? (
                          <StatusPill
                            pillClasses={purchaseRequestPriorityPillClasses(m.priority)}
                            icon={purchaseRequestPriorityIcon(m.priority)}
                          >
                            {PURCHASE_REQUEST_PRIORITY_LABEL[m.priority]}
                          </StatusPill>
                        ) : null}
                      </span>
                    </div>
                    <p className="text-ink-secondary mt-1 text-xs">
                      จำนวน {m.quantity} {m.unit}
                      {canSeeMoney && amount != null ? (
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
                </li>
              );
            })}
          </ul>
          {members.length === 0 ? (
            <p className="text-ink-secondary text-xs">ใบสั่งซื้อนี้ยังไม่มีรายการ</p>
          ) : null}
        </div>

        {/* Spec 260: PO-level charges (transport/discount/other) + the grand
            total, under the line list. Money surface — back office / accounting
            only. add = create-gate roles (isBackOffice); void = manager-only. */}
        {canSeeMoney ? (
          <PoChargesSection
            poId={po.id}
            charges={charges}
            grandTotal={view.total}
            canAdd={isBackOffice}
            canVoid={isManagerRole(ctx.role)}
          />
        ) : null}
      </section>
    </PageShell>
  );
}
