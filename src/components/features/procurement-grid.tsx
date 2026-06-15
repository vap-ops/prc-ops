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

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/features/status-pill";
import { BottomSheet } from "@/components/features/bottom-sheet";
import { PurchaseRequestTracker } from "@/components/features/purchase-request-tracker";
import {
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import {
  purchaseRequestPriorityPillClasses,
  purchaseRequestStatusPillClasses,
} from "@/lib/status-colors";
import { BUTTON_PRIMARY } from "@/lib/ui/classes";
import { adjacentRecordIds, flattenRecordOrder } from "@/lib/purchasing/grid-record-nav";
import type { Database } from "@/lib/db/database.types";
import type { ProcurementBandMeta } from "@/lib/purchasing/procurement-pipeline";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];
type PurchaseRequestPriority = Database["public"]["Enums"]["purchase_request_priority"];

// One serializable record — everything the grid row AND the review drawer need.
// The page enriches each purchase_requests row with wp_code/wp_name + amount.
export interface ProcurementGridRecord {
  id: string;
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
}

type Group = { meta: ProcurementBandMeta; items: ProcurementGridRecord[] };

const baht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;

export function ProcurementGrid({ groups }: { groups: ReadonlyArray<Group> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reading order + id→record lookup, recomputed only when the data changes.
  const order = useMemo(() => flattenRecordOrder(groups), [groups]);
  const byId = useMemo(() => new Map(order.map((r) => [r.id, r])), [order]);

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const { prevId, nextId, index, total } = selectedId
    ? adjacentRecordIds(order, selectedId)
    : { prevId: null, nextId: null, index: -1, total: order.length };

  return (
    <>
      <div className="border-edge bg-card shadow-card rounded-card overflow-hidden border">
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
              />
            ))}
          </tbody>
        </table>
      </div>

      <RecordReviewDrawer
        record={selected}
        position={index >= 0 ? { index, total } : null}
        onClose={() => setSelectedId(null)}
        onPrev={prevId ? () => setSelectedId(prevId) : null}
        onNext={nextId ? () => setSelectedId(nextId) : null}
      />
    </>
  );
}

function BandRows({
  meta,
  items,
  selectedId,
  onSelect,
}: {
  meta: ProcurementBandMeta;
  items: ProcurementGridRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
      {items.map((r) => {
        const isSelected = r.id === selectedId;
        return (
          <tr
            key={r.id}
            className={`border-edge border-t transition-colors ${
              isSelected ? "bg-action-soft" : "hover:bg-sunk"
            }`}
          >
            <td className="px-4 py-2 align-top">
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
            </td>
            <td className="text-ink-secondary px-2 py-2 align-top break-words">
              {r.supplier ?? "—"}
            </td>
            <td className="px-2 py-2 align-top">
              <StatusPill pillClasses={purchaseRequestStatusPillClasses(r.status)}>
                {PURCHASE_REQUEST_STATUS_LABEL[r.status]}
              </StatusPill>
              {r.eta ? <div className="text-ink-muted text-meta mt-1">ETA {r.eta}</div> : null}
            </td>
            <td className="text-ink px-4 py-2 text-right align-top tabular-nums">
              {r.amount != null ? baht(r.amount) : "—"}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// The right-docked review sidesheet (spec 109). Read-only record detail + a
// persistent top bar with prev/next + an n/total counter; "ดำเนินการ →" deep
// links to /requests/[id] to act. Reuses the BottomSheet primitive (side=right).
function RecordReviewDrawer({
  record,
  position,
  onClose,
  onPrev,
  onNext,
}: {
  record: ProcurementGridRecord | null;
  position: { index: number; total: number } | null;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  // site_purchased skipped the requisition pipeline — hide the stepper, mirroring
  // the detail page (spec 66 / ADR 0043).
  const showStepper = record != null && record.status !== "site_purchased";
  return (
    <BottomSheet open={record != null} side="right" title="รายละเอียดคำขอซื้อ" onClose={onClose}>
      {record ? (
        <div className="flex flex-col gap-4">
          {/* Persistent prev/next bar (Airtable's record stepper). */}
          <div className="border-edge flex items-center justify-between gap-2 border-b pb-3">
            <button
              type="button"
              onClick={onPrev ?? undefined}
              disabled={!onPrev}
              className="text-ink hover:bg-sunk focus-visible:ring-action disabled:text-ink-muted inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:hover:bg-transparent"
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
              className="text-ink hover:bg-sunk focus-visible:ring-action disabled:text-ink-muted inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              ถัดไป
              <ChevronRight aria-hidden className="size-4" />
            </button>
          </div>

          {/* Header — PR number, subject (never truncated), status + priority. */}
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

          {/* Facts. */}
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
            {record.supplier ? <Fact label="ผู้ขาย">{record.supplier}</Fact> : null}
            <Fact label="จำนวนเงิน">{record.amount != null ? baht(record.amount) : "—"}</Fact>
            {record.needed_by ? (
              <Fact label="ต้องการภายใน">{formatThaiDate(record.needed_by)}</Fact>
            ) : null}
            {record.eta ? <Fact label="คาดว่าจะได้รับ">{formatThaiDate(record.eta)}</Fact> : null}
          </dl>

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

          {/* Act → the full detail page (approach b). */}
          <Link href={`/requests/${record.id}`} className={`${BUTTON_PRIMARY} w-full`}>
            ดำเนินการ
            <ArrowRight aria-hidden className="ml-1.5 size-4" />
          </Link>
        </div>
      ) : null}
    </BottomSheet>
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
