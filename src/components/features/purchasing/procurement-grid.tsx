"use client";

// Spec 108/109 — the desktop grid worklist + the record-review SIDESHEET
// (the big-screen "Airtable" arc). A dense table of purchase records grouped by
// pipeline band (spec 104); clicking a row opens a RIGHT-SIDE drawer with that
// record's detail + prev/next to step through records without leaving the grid.
//
// Approach (b), operator-picked (spec 109): the drawer is READ-ONLY review
// (facts / supplier / amount / status stepper); a "ดำเนินการ →" button links to
// /requests/[id] to act. No intercepting routes — a client drawer fed by data
// the grid already carries (the page bakes wp name + amount into the rows so a
// client boundary needs no server closures).
//
// Phone keeps the spec-104 card pipeline; this renders only at lg+ on the page.
// amount is money — supplied by the page from an admin read, procurement-gated.

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Info, Package, ShoppingCart } from "lucide-react";
import { StatusPill } from "@/components/features/common/status-pill";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { PurchaseRequestTracker } from "@/components/features/purchasing/purchase-request-tracker";
import { PurchaseMiniStepper } from "@/components/features/purchasing/purchase-mini-stepper";
import {
  PURCHASE_ORDER_STATUS_LABEL,
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import {
  purchaseOrderStatusPillClasses,
  purchaseRequestPriorityPillClasses,
  purchaseRequestStatusPillClasses,
} from "@/lib/status-colors";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/lib/ui/classes";
import { adjacentRecordIds, flattenRecordOrder } from "@/lib/purchasing/grid-record-nav";
import { rowHealth, rowHealthLabel, type RowHealth } from "@/lib/purchasing/row-health";
import { procurementDrawerActions } from "@/lib/purchasing/drawer-actions";
import type { SupplierOption } from "@/components/features/purchasing/purchase-record-form";
import { PurchaseRequestShip } from "@/components/features/purchasing/purchase-request-ship";
import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import { PaymentProofUploader } from "@/components/features/purchasing/payment-proof-uploader";
import { DeliveryPhotoUploader } from "@/components/features/purchasing/delivery-photo-uploader";
import {
  CreatePurchaseOrderSheet,
  type CreatePoLine,
} from "@/components/features/purchasing/create-purchase-order-sheet";
import type { Database } from "@/lib/db/database.types";

// Spec 112: band-relative health → the row's left-edge color. The cell sets
// border-l-4 (width); these set the colour (only the left side has width, so the
// other sides stay invisible). Uses the all-sides color tokens already in use
// elsewhere (border-l-<token> isn't relied on for generation).
const HEALTH_BORDER: Record<RowHealth, string> = {
  late: "border-danger",
  at_risk: "border-attn",
  on_track: "border-done-strong",
  waiting: "border-edge",
};

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];
type PurchaseRequestPriority = Database["public"]["Enums"]["purchase_request_priority"];

// One serializable record — everything the grid row AND the review drawer need.
// The page enriches each purchase_requests row with wp_code/wp_name + amount, and
// (spec 114) the read-only drawer context: requester, note, rejection reason,
// delivery info, document count, plus project_id for the in-drawer uploaders.
export interface ProcurementGridRecord {
  id: string;
  // Spec 134 U2b: the PO this row belongs to (null for a one-off). In the
  // in_transit band, rows are pre-ordered so a PO's members are contiguous and the
  // grid renders one PoHeaderRow before each group.
  purchase_order_id: string | null;
  pr_number: number | null;
  item_description: string;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  quantity: number;
  unit: string;
  supplier: string | null;
  amount: number | null;
  eta: string | null;
  needed_by: string | null;
  requested_at: string;
  decided_at: string | null;
  purchased_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  work_package_id: string;
  wp_code: string | null;
  wp_name: string | null;
  // Spec 114 drawer enrichment.
  project_id: string | null;
  requested_by: string | null;
  requester_name: string | null;
  notes: string | null;
  decision_comment: string | null;
  received_by: string | null;
  delivery_note: string | null;
  doc_count: number;
}

// Structural group meta — a real pipeline band (ProcurementBandMeta) OR a
// synthetic single-status group (spec 110, when a status filter is active, incl.
// the banded-out rejected/cancelled rows). band is used only as a render key.
export interface WorklistGroupMeta {
  band: string;
  label: string;
  hot: boolean;
}

type Group = { meta: WorklistGroupMeta; items: ProcurementGridRecord[] };

// Spec 134 U2b: per-PO header facts rendered above an in_transit PO group (keyed by
// purchase_order_id). Derived by the page from the PO's FULL member set — the same
// roll-up the PO detail shows.
export interface PoHeaderFacts {
  poNumber: number;
  supplier: string;
  status: PurchaseOrderStatus;
  lineCount: number;
}

const baht = (n: number) =>
  `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ProcurementGrid({
  groups,
  today,
  suppliers = [],
  userId,
  poFacts = {},
}: {
  groups: ReadonlyArray<Group>;
  // Bangkok civil date (from the server) — drives the spec-112 health color.
  today: string;
  // Spec 114: in-drawer buyer actions. suppliers feeds the record-purchase form;
  // userId the delivery-photo uploader. Optional — the spec-113 preview/smoke
  // pass neither (uploaders are guarded on userId/project_id).
  suppliers?: ReadonlyArray<SupplierOption>;
  userId?: string;
  // Spec 134 U2b: PO-header facts keyed by purchase_order_id (in_transit grouping).
  poFacts?: Record<string, PoHeaderFacts>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Spec 116: multi-select approved tickets → bundle into one PO. Only possible
  // when the page supplied suppliers (procurement); the spec-113 preview/smoke
  // passes none, so the grid stays selection-free there.
  const canBundle = suppliers.length > 0;
  const [selectedForPO, setSelectedForPO] = useState<ReadonlySet<string>>(new Set());
  const [poOpen, setPoOpen] = useState(false);
  const toggleForPO = (id: string) =>
    setSelectedForPO((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearPO = () => setSelectedForPO(new Set());
  // Spec 120: record a purchase = create a one-line PO. Close the drawer, seed
  // the basket with just this ticket, open the create-PO sheet.
  const createPoFromRecord = (id: string) => {
    setSelectedId(null);
    setSelectedForPO(new Set([id]));
    setPoOpen(true);
  };

  // Reading order + id→record lookup, recomputed only when the data changes.
  const order = useMemo(() => flattenRecordOrder(groups), [groups]);
  const byId = useMemo(() => new Map(order.map((r) => [r.id, r])), [order]);

  // The selected approved tickets, as PO lines (reading order).
  const poLines = useMemo<CreatePoLine[]>(
    () =>
      order
        .filter((r) => selectedForPO.has(r.id))
        .map((r) => ({
          id: r.id,
          pr_number: r.pr_number,
          item_description: r.item_description,
          quantity: r.quantity,
          unit: r.unit,
          wp_code: r.wp_code,
        })),
    [order, selectedForPO],
  );

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const { prevId, nextId, index, total } = selectedId
    ? adjacentRecordIds(order, selectedId)
    : { prevId: null, nextId: null, index: -1, total: order.length };

  return (
    <>
      <div className="border-edge bg-card shadow-card rounded-card overflow-hidden border">
        {/* Spec 117: discoverability — what the checkboxes are for. */}
        {canBundle ? (
          <div className="border-edge text-ink-secondary text-meta flex items-center gap-1.5 border-b px-4 py-2">
            <Info aria-hidden className="size-3.5 shrink-0" />
            เลือกหลายรายการที่อนุมัติแล้ว เพื่อรวมเป็นใบสั่งซื้อเดียว
          </div>
        ) : null}
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[42%]" />
            <col className="w-[22%]" />
            <col className="w-[20%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead>
            <tr className="text-ink-muted border-edge text-meta border-b text-left">
              <th className="px-4 py-2 font-normal">รายการ</th>
              <th className="px-2 py-2 font-normal">ผู้ขาย</th>
              <th className="px-2 py-2 font-normal">สถานะ / ETA</th>
              <th className="px-4 py-2 text-right font-normal">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ meta, items }) => (
              <BandRows
                key={meta.band}
                meta={meta}
                items={items}
                selectedId={selectedId}
                onSelect={setSelectedId}
                today={today}
                selectable={canBundle}
                selectedForPO={selectedForPO}
                onToggleSelect={toggleForPO}
                poFacts={poFacts}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Spec 116: bundle bar — appears once ≥1 approved ticket is checked. */}
      {canBundle && selectedForPO.size > 0 ? (
        <div className="border-edge bg-card shadow-card rounded-card sticky bottom-4 z-20 mt-3 flex items-center justify-between gap-3 border px-4 py-3">
          <span className="text-ink text-sm font-medium">เลือก {selectedForPO.size} รายการ</span>
          <div className="flex gap-2">
            <button type="button" onClick={clearPO} className={BUTTON_SECONDARY}>
              ล้าง
            </button>
            <button type="button" onClick={() => setPoOpen(true)} className={BUTTON_PRIMARY}>
              สร้าง PO ({selectedForPO.size})
            </button>
          </div>
        </div>
      ) : null}

      {/* Mounted only when bundling is possible (suppliers present). The
          spec-113 preview/smoke passes no suppliers, so the sheet — and its
          useRouter — never mounts there. */}
      {canBundle ? (
        <CreatePurchaseOrderSheet
          open={poOpen}
          lines={poLines}
          suppliers={suppliers}
          onClose={() => setPoOpen(false)}
          onCreated={() => {
            setPoOpen(false);
            clearPO();
          }}
        />
      ) : null}

      <RecordReviewDrawer
        record={selected}
        position={index >= 0 ? { index, total } : null}
        onClose={() => setSelectedId(null)}
        onPrev={prevId ? () => setSelectedId(prevId) : null}
        onNext={nextId ? () => setSelectedId(nextId) : null}
        userId={userId}
        onCreatePo={canBundle ? createPoFromRecord : undefined}
      />
    </>
  );
}

function BandRows({
  meta,
  items,
  selectedId,
  onSelect,
  today,
  selectable,
  selectedForPO,
  onToggleSelect,
  poFacts,
}: {
  meta: WorklistGroupMeta;
  items: ProcurementGridRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  today: string;
  selectable: boolean;
  selectedForPO: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  poFacts: Record<string, PoHeaderFacts>;
}) {
  return (
    <>
      <tr className={meta.hot ? "bg-attn-soft" : "bg-sunk"}>
        <td
          colSpan={4}
          className={`text-meta px-4 py-1.5 font-semibold ${
            meta.hot ? "text-attn-ink" : "text-ink-secondary"
          }`}
        >
          {meta.label} · {items.length}
        </td>
      </tr>
      {items.map((r, idx) => {
        const isSelected = r.id === selectedId;
        // Spec 117: a row checked for PO bundling stays highlighted on the grid.
        const isChecked = selectedForPO.has(r.id);
        // Spec 112: the row's health (band-relative time pressure) → left-edge color.
        const health = rowHealth(r.status, r.eta, r.needed_by, today);
        // Spec 134 U2b: in the in_transit band (rows pre-ordered so a PO's members
        // are contiguous), render a PO header before the first row of each group.
        const poId = r.purchase_order_id;
        const showPoHeader =
          meta.band === "in_transit" &&
          poId != null &&
          poId !== (idx > 0 ? (items[idx - 1]?.purchase_order_id ?? null) : null);
        const headerFacts = showPoHeader && poId ? poFacts[poId] : undefined;
        return (
          <Fragment key={r.id}>
            {showPoHeader && poId && headerFacts ? (
              <PoHeaderRow poId={poId} facts={headerFacts} />
            ) : null}
            <tr
              className={`border-edge border-t transition-colors ${
                isSelected || isChecked ? "bg-action-soft" : "hover:bg-sunk"
              }`}
            >
              <td
                title={rowHealthLabel(health)}
                className={`border-l-4 px-4 py-2 align-top ${HEALTH_BORDER[health]}`}
              >
                <div className="flex items-start gap-2.5">
                  {/* Spec 116: bundle checkbox — only on approved (to_order) rows. */}
                  {selectable && r.status === "approved" ? (
                    <input
                      type="checkbox"
                      checked={selectedForPO.has(r.id)}
                      onChange={() => onToggleSelect(r.id)}
                      aria-label={`เลือก ${r.item_description} เข้าใบสั่งซื้อ`}
                      className="accent-action mt-1 size-5 shrink-0 cursor-pointer"
                    />
                  ) : null}
                  <div className="min-w-0">
                    {/* Spec 109: the row opens the review drawer (not a full nav). */}
                    <button
                      type="button"
                      onClick={() => onSelect(r.id)}
                      aria-haspopup="dialog"
                      className="text-ink hover:text-action text-left font-medium break-words focus:outline-none focus-visible:underline"
                    >
                      {r.item_description}
                    </button>
                    <div className="text-ink-muted text-meta">
                      {r.pr_number ? <span className="font-mono">PR-{r.pr_number}</span> : null}
                      {r.wp_name ? <span> · {r.wp_name}</span> : null}
                    </div>
                  </div>
                </div>
              </td>
              <td className="text-ink-secondary px-2 py-2 align-top break-words">
                {r.supplier ?? "—"}
              </td>
              <td className="px-2 py-2 align-top">
                {/* Spec 111: compact process bar above the pill (grid-density echo
                  of the tracker). */}
                <PurchaseMiniStepper status={r.status} />
                <div className="mt-1.5">
                  <StatusPill pillClasses={purchaseRequestStatusPillClasses(r.status)}>
                    {PURCHASE_REQUEST_STATUS_LABEL[r.status]}
                  </StatusPill>
                </div>
                {r.eta ? (
                  <div
                    className={`text-meta mt-1 ${health === "late" ? "text-danger font-semibold" : "text-ink-muted"}`}
                  >
                    ETA {r.eta}
                  </div>
                ) : null}
              </td>
              <td className="text-ink px-4 py-2 text-right align-top tabular-nums">
                {r.amount != null ? baht(r.amount) : "—"}
              </td>
            </tr>
          </Fragment>
        );
      })}
    </>
  );
}

// Spec 134 U2b: the PO group header row inside the in_transit band — PO number,
// supplier, derived roll-up status, and line count, linking to the PO detail. The
// whole row is one anchor; it does NOT open the record drawer (it is navigation,
// not a record). Rendered only for the in_transit band, where the page pre-orders
// rows so each PO's members are contiguous beneath their header.
function PoHeaderRow({ poId, facts }: { poId: string; facts: PoHeaderFacts }) {
  return (
    <tr className="border-edge border-t">
      <td colSpan={4} className="bg-card px-4 py-1.5">
        <Link
          href={`/requests/orders/${poId}`}
          className="text-ink hover:bg-sunk focus-visible:ring-action -mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 transition-colors focus:outline-none focus-visible:ring-2"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Package aria-hidden className="text-ink-muted size-3.5 shrink-0" />
            <span className="text-ink-secondary text-meta font-mono">
              PO-{String(facts.poNumber).padStart(4, "0")}
            </span>
            <span className="text-ink truncate text-sm font-medium">{facts.supplier}</span>
            <span className="text-ink-muted text-meta shrink-0">· {facts.lineCount} รายการ</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <StatusPill pillClasses={purchaseOrderStatusPillClasses(facts.status)}>
              {PURCHASE_ORDER_STATUS_LABEL[facts.status]}
            </StatusPill>
            <ChevronRight aria-hidden className="text-ink-muted size-4" />
          </span>
        </Link>
      </td>
    </tr>
  );
}

// The right-docked review sidesheet (spec 109/114). The record identity (prev/next
// + PR# + item + status) is PINNED at the top so a buyer stepping records can't act
// on the wrong row; below it is the enriched read-only context and the in-place
// buyer actions (spec 114). Reuses the BottomSheet primitive (side=right).
function RecordReviewDrawer({
  record,
  position,
  onClose,
  onPrev,
  onNext,
  userId,
  onCreatePo,
}: {
  record: ProcurementGridRecord | null;
  position: { index: number; total: number } | null;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  userId: string | undefined;
  onCreatePo: ((id: string) => void) | undefined;
}) {
  return (
    <BottomSheet open={record != null} side="right" title="รายละเอียดคำขอซื้อ" onClose={onClose}>
      {record ? (
        // key on the record so the action forms remount (reset their state) when
        // stepping prev/next — never carry a half-typed amount onto another row.
        <DrawerBody
          key={record.id}
          record={record}
          position={position}
          onPrev={onPrev}
          onNext={onNext}
          userId={userId}
          onCreatePo={onCreatePo}
        />
      ) : null}
    </BottomSheet>
  );
}

function DrawerBody({
  record,
  position,
  onPrev,
  onNext,
  userId,
  onCreatePo,
}: {
  record: ProcurementGridRecord;
  position: { index: number; total: number } | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  userId: string | undefined;
  onCreatePo: ((id: string) => void) | undefined;
}) {
  // site_purchased skipped the requisition pipeline — hide the stepper, mirroring
  // the detail page (spec 66 / ADR 0043).
  const showStepper = record.status !== "site_purchased";
  const actions = procurementDrawerActions(record.status);
  const hasActions = actions.record || actions.ship || actions.invoice || actions.deliveryPhoto;
  const stepBtn =
    "text-ink hover:bg-sunk focus-visible:ring-action disabled:text-ink-muted inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  return (
    <div className="flex flex-col gap-4">
      {/* PINNED record identity (spec 114 guardrail): prev/next + PR#/item/status
          stay visible while the body scrolls to the action forms. */}
      <div className="bg-card border-edge sticky top-0 z-10 -mx-5 -mt-4 flex flex-col gap-3 border-b px-5 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onPrev ?? undefined}
            disabled={!onPrev}
            className={stepBtn}
          >
            <ChevronLeft aria-hidden className="size-4" />
            ก่อนหน้า
          </button>
          {position ? (
            <span className="text-ink-muted text-meta tabular-nums">
              {position.index + 1} / {position.total}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onNext ?? undefined}
            disabled={!onNext}
            className={stepBtn}
          >
            ถัดไป
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {record.pr_number ? (
              <p className="text-ink-secondary font-mono text-xs">
                PR-{String(record.pr_number).padStart(4, "0")}
              </p>
            ) : null}
            <h3 className="text-ink mt-0.5 text-base font-semibold break-words">
              {record.item_description}
            </h3>
          </div>
          <span className="mt-0.5 flex shrink-0 flex-col items-end gap-1">
            <StatusPill pillClasses={purchaseRequestStatusPillClasses(record.status)}>
              {PURCHASE_REQUEST_STATUS_LABEL[record.status]}
            </StatusPill>
            {record.priority !== "normal" ? (
              <StatusPill pillClasses={purchaseRequestPriorityPillClasses(record.priority)}>
                {PURCHASE_REQUEST_PRIORITY_LABEL[record.priority]}
              </StatusPill>
            ) : null}
          </span>
        </div>
      </div>

      {/* Facts + enriched read-only context (spec 114). */}
      <dl className="flex flex-col gap-2 text-sm">
        <Fact label="จำนวน">
          {record.quantity} {record.unit}
        </Fact>
        {record.wp_code || record.wp_name ? (
          <Fact label="งาน">
            {record.wp_code ? <span className="font-mono">{record.wp_code}</span> : null}
            {record.wp_code && record.wp_name ? <span className="mx-1">·</span> : null}
            {record.wp_name}
          </Fact>
        ) : null}
        {record.requester_name ? (
          <Fact label="ผู้ขอซื้อ">
            {record.requested_by && record.requested_by === userId ? (
              <span className="border-action bg-action-soft text-action mr-1.5 inline-flex items-center rounded-full border px-1.5 text-[10px] font-semibold">
                ของฉัน
              </span>
            ) : null}
            {record.requester_name}
          </Fact>
        ) : null}
        <Fact label="ขอเมื่อ">{formatThaiDate(record.requested_at)}</Fact>
        {record.supplier ? <Fact label="ผู้ขาย">{record.supplier}</Fact> : null}
        <Fact label="จำนวนเงิน">{record.amount != null ? baht(record.amount) : "—"}</Fact>
        {record.needed_by ? (
          <Fact label="ต้องการภายใน">{formatThaiDate(record.needed_by)}</Fact>
        ) : null}
        {record.eta ? <Fact label="คาดว่าจะได้รับ">{formatThaiDate(record.eta)}</Fact> : null}
        {record.status === "delivered" && record.received_by ? (
          <Fact label="ผู้รับของ">{record.received_by}</Fact>
        ) : null}
        <Fact label="เอกสาร/รูป">{record.doc_count > 0 ? `${record.doc_count} รายการ` : "—"}</Fact>
      </dl>

      {record.notes ? (
        <p className="text-ink-secondary text-xs whitespace-pre-wrap">หมายเหตุ: {record.notes}</p>
      ) : null}
      {record.status === "delivered" && record.delivery_note ? (
        <p className="text-ink-secondary text-xs whitespace-pre-wrap">{record.delivery_note}</p>
      ) : null}
      {record.status === "rejected" && record.decision_comment ? (
        <div className="border-danger-edge bg-danger-soft text-danger-ink rounded-md border px-3 py-2 text-xs">
          <span className="font-semibold">เหตุผลที่ไม่อนุมัติ: </span>
          <span className="whitespace-pre-wrap">{record.decision_comment}</span>
        </div>
      ) : null}

      {/* Status stepper — reuse the order-tracking pipeline (spec 22). */}
      {showStepper ? (
        <div className="border-edge border-t pt-4">
          <PurchaseRequestTracker
            status={record.status}
            requestedAt={record.requested_at}
            decidedAt={record.decided_at}
            purchasedAt={record.purchased_at}
            shippedAt={record.shipped_at}
            deliveredAt={record.delivered_at}
            eta={record.eta}
          />
        </div>
      ) : null}

      {/* In-place buyer actions (spec 114) — gated by status. Decisions are PM-only
          and never appear on this procurement surface. */}
      {hasActions ? (
        <div className="border-edge flex flex-col gap-3 border-t pt-4">
          <h4 className="text-ink text-sm font-semibold">ดำเนินการ</h4>
          {/* Spec 120: record a purchase = create a one-line PO (pre-seeded). */}
          {actions.record && onCreatePo ? (
            <button
              type="button"
              onClick={() => onCreatePo(record.id)}
              className={`${BUTTON_PRIMARY} w-full`}
            >
              <ShoppingCart aria-hidden className="mr-1.5 size-4" />
              สร้างใบสั่งซื้อ (PO)
            </button>
          ) : null}
          {actions.ship ? <PurchaseRequestShip requestId={record.id} /> : null}
          {actions.deliveryPhoto && record.project_id && userId ? (
            <DeliveryPhotoUploader
              purchaseRequestId={record.id}
              projectId={record.project_id}
              userId={userId}
            />
          ) : null}
          {actions.invoice && record.project_id ? (
            <InvoiceUploader purchaseRequestId={record.id} projectId={record.project_id} />
          ) : null}
          {/* Bug 2: proof of payment shares the invoice visibility window. */}
          {actions.invoice && record.project_id ? (
            <PaymentProofUploader purchaseRequestId={record.id} projectId={record.project_id} />
          ) : null}
        </div>
      ) : null}

      {/* Full record (photo galleries, attachments, history). */}
      <Link href={`/requests/${record.id}`} className={`${BUTTON_PRIMARY} w-full`}>
        เปิดรายละเอียดทั้งหมด
        <ArrowRight aria-hidden className="ml-1.5 size-4" />
      </Link>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted text-xs">{label}</dt>
      <dd className="text-ink min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}
