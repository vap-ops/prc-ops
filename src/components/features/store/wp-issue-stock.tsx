"use client";

// Spec 177 U5 + spec 208 U3 — เบิก at the WP detail. A site staffer (site_admin
// draws at the WP, plus the PM tier) pulls stock from the project store TO this
// work package, at moving-average cost (the issue_stock_bulk RPC handles costing +
// decrement). Spec 208 U3: the เบิก sheet is a MULTI-LINE grid — withdraw several
// items to this WP in one atomic call. 'use client': the grid state, the submit
// transition, the refresh.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { ReturnToStoreControl } from "@/components/features/store/return-to-store-control";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { STORE_ISSUE_LABEL, STORE_FIX_WRONG_ENTRY_LABEL } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { confirmStockIssueOnBehalf, issueStockBulk, reverseStockIssue } from "@/app/store/actions";

// On-hand for the picker — only what the WP เบิก needs (the value/avg-cost columns
// the /store console shows are not relevant when drawing to a WP).
export type WpStockRow = {
  catalogItemId: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qtyOnHand: number;
};

export type WpIssueRow = {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
  unitCost: number;
  // Custody (spec 177 U6/U7): the named receiver + whether they've confirmed.
  receiverName: string | null;
  receivedAt: string | null;
  // Spec 209 U2: qty already returned to the store from this issue (≤ qty).
  returnedQty: number;
};

// Spec 208 U3 — one draft row of the multi-line เบิก grid.
type DraftIssueRow = { item: string; qty: string; receiver: string; note: string };
const emptyIssueRow = (): DraftIssueRow => ({ item: "", qty: "", receiver: "", note: "" });

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function WpIssueStock({
  projectId,
  workPackageId,
  onHand,
  workers,
  issues,
}: {
  projectId: string;
  workPackageId: string;
  onHand: WpStockRow[];
  workers: { id: string; name: string }[];
  issues: WpIssueRow[];
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DraftIssueRow[]>([emptyIssueRow()]);
  const [error, setError] = useState<string | null>(null);
  const [issuing, startIssue] = useTransition();

  function updateRow(i: number, patch: Partial<DraftIssueRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyIssueRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));
  }

  const onHandOf = (id: string) => onHand.find((o) => o.catalogItemId === id) ?? null;
  // Spec 208 U2/U3 — per-row qty ceiling: you cannot เบิก more than is on hand
  // (the issue_stock_bulk RPC also 22023s; this blocks it before the round-trip).
  const rowOverStock = (r: DraftIssueRow) => {
    const oh = onHandOf(r.item);
    const q = Number(r.qty);
    return oh !== null && Number.isFinite(q) && q > oh.qtyOnHand;
  };
  const rowComplete = (r: DraftIssueRow) => {
    const q = Number(r.qty);
    return r.item !== "" && r.qty !== "" && Number.isFinite(q) && q > 0 && !rowOverStock(r);
  };
  const completeRows = rows.filter(rowComplete);
  const anyOverStock = rows.some(rowOverStock);
  const canSubmit = completeRows.length > 0 && !anyOverStock && !issuing;

  function reset() {
    setRows([emptyIssueRow()]);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startIssue(async () => {
      const result = await issueStockBulk({
        projectId,
        workPackageId,
        lines: completeRows.map((r) => ({
          catalogItemId: r.item,
          qty: Number(r.qty),
          note: r.note,
          ...(r.receiver !== "" ? { receiverWorkerId: r.receiver } : {}),
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {onHand.length === 0 ? (
        <p className="text-ink-secondary text-body">ยังไม่มีสต๊อกในสโตร์</p>
      ) : (
        <div>
          <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
            เบิกวัสดุจากสโตร์
          </button>
        </div>
      )}

      {issues.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {issues.map((i) => (
            <li
              key={i.id}
              className="border-edge bg-card rounded-control flex flex-wrap items-center gap-3 border px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="text-ink text-body block font-semibold">{i.baseItem}</span>
                <span className="text-ink-secondary text-meta block">
                  {i.specAttrs ? `${i.specAttrs} · ` : ""}
                  ต้นทุน {baht(i.unitCost)} ฿/{i.unit}
                </span>
                {i.receiverName ? (
                  <span className="text-meta mt-0.5 block">
                    <span className={i.receivedAt ? "text-action" : "text-ink-muted"}>
                      {i.receivedAt ? "รับแล้ว" : "รอรับ"}
                    </span>
                    <span className="text-ink-secondary"> · {i.receiverName}</span>
                  </span>
                ) : null}
              </span>
              <span className="text-ink text-body shrink-0 font-semibold">
                {i.qty} {i.unit}
              </span>
              {/* Spec 209 U2 — the REAL return: send a partial qty of issued
                  material back to the store (offcuts/leftovers), at the issue cost. */}
              <ReturnToStoreControl
                issueId={i.id}
                baseItem={i.baseItem}
                unit={i.unit}
                remaining={i.qty - i.returnedQty}
              />
              {/* Spec 210 — confirm-on-behalf moved here from the store console: a
                  site staffer attests receipt for a named receiver who is still
                  รอรับ, right where the เบิก was made. The RPC blocks the issuer
                  (separation of duties) and the error maps cleanly. */}
              {i.receiverName && !i.receivedAt ? (
                <ConfirmActionButton
                  idleLabel="ยืนยันรับแทน"
                  pendingLabel="กำลังยืนยัน…"
                  confirmMessage={`ยืนยันว่าผู้รับได้รับ ${i.baseItem} ${i.qty} ${i.unit} แล้ว (ยืนยันแทนผู้รับ)?`}
                  confirmLabel="ยืนยัน"
                  buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
                  action={() => confirmStockIssueOnBehalf({ issueId: i.id })}
                />
              ) : null}
              {/* Spec 178 Stream B — undo a wrong เบิก here too (mirrors /store U12).
                  This block only renders for SITE_STAFF (the WP-detail !readOnly
                  gate), which is the reverse_stock_issue gate. */}
              <ConfirmActionButton
                idleLabel={STORE_FIX_WRONG_ENTRY_LABEL}
                pendingLabel="กำลังแก้ไข…"
                confirmMessage={`ลบรายการเบิกที่บันทึกผิด — ${i.baseItem} ${i.qty} ${i.unit}? ใช้เมื่อบันทึกผิด ไม่ใช่การคืนของจริง (ของจะถูกคืนเข้าสโตร์)`}
                confirmLabel="ยืนยัน"
                buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
                action={() => reverseStockIssue({ issueId: i.id })}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <BottomSheet open={open} title={STORE_ISSUE_LABEL} onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Spec 208 U3: a multi-row grid — เบิก a whole list to this WP at once. */}
          <ul className="flex flex-col gap-4">
            {rows.map((r, i) => {
              const selected = onHandOf(r.item);
              const over = rowOverStock(r);
              return (
                <li key={i} className="border-edge rounded-control flex flex-col gap-3 border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-meta text-ink-secondary font-semibold">
                      รายการ {i + 1}
                    </span>
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        disabled={issuing}
                        className="text-danger text-meta font-medium"
                      >
                        ลบ
                      </button>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`wp-issue-item-${i}`} className={LABEL}>
                      วัสดุ
                    </label>
                    <select
                      id={`wp-issue-item-${i}`}
                      value={r.item}
                      onChange={(e) => updateRow(i, { item: e.target.value })}
                      disabled={issuing}
                      className={FIELD}
                    >
                      <option value="">เลือกวัสดุ</option>
                      {onHand.map((o) => (
                        <option key={o.catalogItemId} value={o.catalogItemId}>
                          {o.baseItem}
                          {o.specAttrs ? ` · ${o.specAttrs}` : ""} (มี {o.qtyOnHand} {o.unit})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`wp-issue-qty-${i}`} className={LABEL}>
                      จำนวน
                    </label>
                    <input
                      id={`wp-issue-qty-${i}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={r.qty}
                      onChange={(e) => updateRow(i, { qty: e.target.value })}
                      disabled={issuing}
                      className={FIELD}
                    />
                    {selected ? (
                      <p className={`text-meta ${over ? "text-danger" : "text-ink-secondary"}`}>
                        {over
                          ? `เกินจำนวนในสโตร์ (มี ${selected.qtyOnHand} ${selected.unit})`
                          : `มีในมือ ${selected.qtyOnHand} ${selected.unit}`}
                      </p>
                    ) : null}
                  </div>

                  {/* Custody (spec 177 U7): name the receiver who takes the material;
                      they confirm receipt later from the worker portal. Optional. */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`wp-issue-receiver-${i}`} className={LABEL}>
                      ผู้รับ (ถ้ามี)
                    </label>
                    <select
                      id={`wp-issue-receiver-${i}`}
                      value={r.receiver}
                      onChange={(e) => updateRow(i, { receiver: e.target.value })}
                      disabled={issuing}
                      className={FIELD}
                    >
                      <option value="">ไม่ระบุ</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`wp-issue-note-${i}`} className={LABEL}>
                      หมายเหตุ (ถ้ามี)
                    </label>
                    <input
                      id={`wp-issue-note-${i}`}
                      type="text"
                      value={r.note}
                      maxLength={1000}
                      onChange={(e) => updateRow(i, { note: e.target.value })}
                      disabled={issuing}
                      className={FIELD}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <button type="button" onClick={addRow} disabled={issuing} className={BUTTON_SECONDARY}>
            + เพิ่มรายการ
          </button>

          {error ? (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {issuing ? "กำลังเบิก…" : "ยืนยันการเบิก"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
