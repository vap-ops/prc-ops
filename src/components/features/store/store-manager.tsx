"use client";

// Spec 177 U2 — the /store surface. A back-office user picks a project, sees its
// on-hand stock (qty + value + derived moving-average cost), and records a
// stock-in (รับเข้า) of a catalog item at cost. 'use client': the project
// selector navigation, the record-sheet state, the submit transition + refresh.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { ConfirmActionButton } from "@/components/features/common/confirm-action-button";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import {
  ITEM_CATEGORY_LABEL,
  STORE_RECEIVE_LABEL,
  STORE_FIX_WRONG_ENTRY_LABEL,
} from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import type { Database } from "@/lib/db/database.types";
import { recordStockCount, recordStockInBulk, reverseStockReceipt } from "@/app/store/actions";

// Spec 198 U1 — one draft row of the multi-line รับเข้า grid.
type DraftReceiptRow = {
  item: string;
  qty: string;
  unitCost: string;
  supplier: string;
  note: string;
};
const emptyReceiptRow = (): DraftReceiptRow => ({
  item: "",
  qty: "",
  unitCost: "",
  supplier: "",
  note: "",
});
const receiptRowComplete = (r: DraftReceiptRow): boolean => {
  const q = Number(r.qty);
  const c = Number(r.unitCost);
  return (
    r.item !== "" &&
    r.qty !== "" &&
    Number.isFinite(q) &&
    q > 0 &&
    r.unitCost !== "" &&
    Number.isFinite(c) &&
    c >= 0
  );
};

type ItemCategory = Database["public"]["Enums"]["item_category"];

export type CatalogPick = {
  id: string;
  category: ItemCategory;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
};

export type StockRow = {
  catalogItemId: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qtyOnHand: number;
  totalValue: number;
};

export type ReceiptRow = {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
  unitCost: number;
};

// Spec 178 B3 — a past physical count, for the ประวัติการนับ history list.
export type CountRow = {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  countedQty: number;
  variance: number;
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function StoreManager({
  projects,
  selectedProjectId,
  onHand,
  catalogItems,
  suppliers,
  canIssue,
  receipts,
  counts,
  hidePicker = false,
  emptyStateSupplyPlanHref = null,
}: {
  projects: { id: string; code: string; name: string }[];
  selectedProjectId: string | null;
  onHand: StockRow[];
  catalogItems: CatalogPick[];
  suppliers: { id: string; name: string }[];
  canIssue: boolean;
  receipts: ReceiptRow[];
  // Spec 178 B3 — recent physical counts (the ประวัติการนับ history).
  counts: CountRow[];
  // Spec 197 U1: on the per-project คลัง sub-route the project comes from the
  // URL, so the picker is suppressed (RLS already scopes the viewer). The legacy
  // global picker is kept (default false) for any caller still passing a list.
  hidePicker?: boolean;
  // Spec 197 U3: when the store is empty, the empty state points at แผนจัดหา as a
  // second way to fill it. A non-null href renders แผนจัดหา as a link to the
  // supply-plan chip; null (the viewer can't plan supply, e.g. site_admin) keeps
  // it plain text so it is never a dead link.
  emptyStateSupplyPlanHref?: string | null;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  // Spec 198 U1 — the รับเข้า grid: a list of draft rows, recorded in one bulk
  // call. Starts with a single empty row.
  const [rows, setRows] = useState<DraftReceiptRow[]>([emptyReceiptRow()]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  function updateRow(i: number, patch: Partial<DraftReceiptRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, emptyReceiptRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));
  }

  // ตรวจนับ (physical count) sheet — opened for a specific on-hand row.
  const [countRow, setCountRow] = useState<StockRow | null>(null);
  const [countQty, setCountQty] = useState("");
  const [countNote, setCountNote] = useState("");
  const [countError, setCountError] = useState<string | null>(null);
  const [counting, startCount] = useTransition();

  const countQtyNum = Number(countQty);
  const countValid = countQty !== "" && Number.isFinite(countQtyNum) && countQtyNum >= 0;
  const variance = countRow && countValid ? countQtyNum - countRow.qtyOnHand : null;

  function openCount(row: StockRow) {
    setCountRow(row);
    setCountQty("");
    setCountNote("");
    setCountError(null);
  }

  function handleCountSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!countValid || !selectedProjectId || !countRow || counting) return;
    setCountError(null);
    startCount(async () => {
      const result = await recordStockCount({
        projectId: selectedProjectId,
        catalogItemId: countRow.catalogItemId,
        countedQty: countQtyNum,
        note: countNote,
      });
      if (!result.ok) {
        setCountError(result.error);
        return;
      }
      setCountRow(null);
      router.refresh();
    });
  }

  const completeRows = rows.filter(receiptRowComplete);
  const canSubmit = completeRows.length > 0 && !submitting;

  const categories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];

  function reset() {
    setRows([emptyReceiptRow()]);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || !selectedProjectId) return;
    const lines = completeRows.map((r) => ({
      catalogItemId: r.item,
      qty: Number(r.qty),
      unitCost: Number(r.unitCost),
      supplierId: r.supplier,
      note: r.note,
    }));
    setError(null);
    startSubmit(async () => {
      const result = await recordStockInBulk({ projectId: selectedProjectId, lines });
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
    <div className="flex flex-col gap-4">
      {hidePicker ? null : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="store-project" className={LABEL}>
            โครงการ
          </label>
          <select
            id="store-project"
            value={selectedProjectId ?? ""}
            onChange={(e) => router.push(`/store?project=${e.target.value}`)}
            className={FIELD}
          >
            <option value="">เลือกโครงการ</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedProjectId ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-ink text-body font-semibold">สต๊อกในมือ</h2>
            {/* Spec 197 U3: when empty, the empty state below owns the primary
                รับเข้า lead — drop the secondary header button to avoid two. */}
            {onHand.length > 0 ? (
              <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
                {STORE_RECEIVE_LABEL}
              </button>
            ) : null}
          </div>

          {onHand.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-ink-secondary text-body">
                ยังไม่มีของในคลัง — เริ่มจากรับเข้า หรือผ่าน
                {emptyStateSupplyPlanHref ? (
                  <Link href={emptyStateSupplyPlanHref} className="text-action underline">
                    แผนจัดหา
                  </Link>
                ) : (
                  "แผนจัดหา"
                )}
              </p>
              <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
                {STORE_RECEIVE_LABEL}
              </button>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {onHand.map((r) => {
                const avg = r.qtyOnHand > 0 ? r.totalValue / r.qtyOnHand : 0;
                return (
                  <li
                    key={r.catalogItemId}
                    className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-ink text-body block font-semibold">{r.baseItem}</span>
                      <span className="text-ink-secondary text-meta block">
                        {r.specAttrs ? `${r.specAttrs} · ` : ""}
                        ต้นทุนเฉลี่ย {baht(avg)} ฿/{r.unit}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="text-ink text-body block font-semibold">
                        {r.qtyOnHand} {r.unit}
                      </span>
                      <span className="text-ink-secondary text-meta block">
                        {baht(r.totalValue)} ฿
                      </span>
                    </span>
                    {/* Spec 208: เบิก is initiated on the WP detail page (เบิกของ tab),
                        not the store console — only ตรวจนับ stays here. */}
                    {canIssue ? (
                      <button
                        type="button"
                        onClick={() => openCount(r)}
                        className={`${BUTTON_SECONDARY} shrink-0`}
                      >
                        ตรวจนับ
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {/* รับเข้าล่าสุด — any /store user (BACK_OFFICE = the receipt-reverse gate)
              can กลับรายการ a wrong รับเข้า. */}
          {receipts.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-ink text-body font-semibold">รับเข้าล่าสุด</h2>
              <ul className="flex flex-col gap-2">
                {receipts.map((rc) => (
                  <li
                    key={rc.id}
                    className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-ink text-body block font-semibold">{rc.baseItem}</span>
                      <span className="text-ink-secondary text-meta block">
                        {rc.specAttrs ? `${rc.specAttrs} · ` : ""}
                        ต้นทุน {baht(rc.unitCost)} ฿/{rc.unit}
                      </span>
                    </span>
                    <span className="text-ink text-body shrink-0 font-semibold">
                      {rc.qty} {rc.unit}
                    </span>
                    <ConfirmActionButton
                      idleLabel={STORE_FIX_WRONG_ENTRY_LABEL}
                      pendingLabel="กำลังแก้ไข…"
                      confirmMessage={`ลบรายการรับเข้าที่บันทึกผิด — ${rc.baseItem} ${rc.qty} ${rc.unit}? ใช้เมื่อบันทึกผิดเท่านั้น (ของจะถูกตัดออกจากสโตร์)`}
                      confirmLabel="ยืนยัน"
                      buttonClassName={`${BUTTON_SECONDARY} shrink-0`}
                      action={() => reverseStockReceipt({ receiptId: rc.id })}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Spec 178 B3 — ประวัติการนับ: a read-only audit trail of past counts
              (variance = counted − system, valued shrinkage shows in the P&L). */}
          {counts.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-ink text-body font-semibold">ประวัติการนับ</h2>
              <ul className="flex flex-col gap-2">
                {counts.map((c) => (
                  <li
                    key={c.id}
                    className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-ink text-body block font-semibold">{c.baseItem}</span>
                      <span className="text-ink-secondary text-meta block">
                        {c.specAttrs ? `${c.specAttrs} · ` : ""}
                        นับได้ {c.countedQty} {c.unit}
                      </span>
                    </span>
                    <span
                      className={`text-meta shrink-0 font-semibold ${
                        c.variance < 0
                          ? "text-danger"
                          : c.variance > 0
                            ? "text-action"
                            : "text-ink-muted"
                      }`}
                    >
                      ส่วนต่าง {c.variance > 0 ? "+" : ""}
                      {c.variance} {c.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <BottomSheet open={open} title={STORE_RECEIVE_LABEL} onClose={() => setOpen(false)}>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* Spec 198 U1: a multi-row grid — check in a whole delivery at once
                  instead of one item per submit. */}
              <ul className="flex flex-col gap-4">
                {rows.map((r, i) => (
                  <li
                    key={i}
                    className="border-edge rounded-control flex flex-col gap-3 border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-meta text-ink-secondary font-semibold">
                        รายการ {i + 1}
                      </span>
                      {rows.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          disabled={submitting}
                          className="text-danger text-meta font-medium"
                        >
                          ลบ
                        </button>
                      ) : null}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`store-item-${i}`} className={LABEL}>
                        วัสดุ
                      </label>
                      <select
                        id={`store-item-${i}`}
                        value={r.item}
                        onChange={(e) => updateRow(i, { item: e.target.value })}
                        disabled={submitting}
                        className={FIELD}
                      >
                        <option value="">เลือกวัสดุ</option>
                        {categories.map((c) => {
                          const opts = catalogItems.filter((ci) => ci.category === c);
                          if (opts.length === 0) return null;
                          return (
                            <optgroup key={c} label={ITEM_CATEGORY_LABEL[c]}>
                              {opts.map((ci) => (
                                <option key={ci.id} value={ci.id}>
                                  {ci.baseItem}
                                  {ci.specAttrs ? ` · ${ci.specAttrs}` : ""} ({ci.unit})
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                    </div>

                    <div className="flex gap-3">
                      <div className="flex flex-1 flex-col gap-1.5">
                        <label htmlFor={`store-qty-${i}`} className={LABEL}>
                          จำนวน
                        </label>
                        <input
                          id={`store-qty-${i}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={r.qty}
                          onChange={(e) => updateRow(i, { qty: e.target.value })}
                          disabled={submitting}
                          className={FIELD}
                        />
                      </div>
                      <div className="flex flex-1 flex-col gap-1.5">
                        <label htmlFor={`store-cost-${i}`} className={LABEL}>
                          ราคาต้นทุน/หน่วย (บาท)
                        </label>
                        <input
                          id={`store-cost-${i}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={r.unitCost}
                          onChange={(e) => updateRow(i, { unitCost: e.target.value })}
                          disabled={submitting}
                          className={FIELD}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`store-supplier-${i}`} className={LABEL}>
                        ผู้ขาย (ถ้ามี)
                      </label>
                      <select
                        id={`store-supplier-${i}`}
                        value={r.supplier}
                        onChange={(e) => updateRow(i, { supplier: e.target.value })}
                        disabled={submitting}
                        className={FIELD}
                      >
                        <option value="">ไม่ระบุ</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`store-note-${i}`} className={LABEL}>
                        หมายเหตุ (ถ้ามี)
                      </label>
                      <input
                        id={`store-note-${i}`}
                        type="text"
                        value={r.note}
                        maxLength={1000}
                        onChange={(e) => updateRow(i, { note: e.target.value })}
                        disabled={submitting}
                        className={FIELD}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={addRow}
                disabled={submitting}
                className={BUTTON_SECONDARY}
              >
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
                  {submitting ? "กำลังบันทึก…" : "บันทึกทั้งหมด"}
                </button>
              </div>
            </form>
          </BottomSheet>

          <BottomSheet
            open={countRow !== null}
            title="ตรวจนับสต๊อก"
            onClose={() => setCountRow(null)}
          >
            <form onSubmit={handleCountSubmit} className="flex flex-col gap-4">
              <p className="text-ink-secondary text-meta">
                ตรวจนับ{" "}
                <span className="text-ink font-semibold">
                  {countRow?.baseItem}
                  {countRow?.specAttrs ? ` · ${countRow.specAttrs}` : ""}
                </span>{" "}
                — ระบบมี {countRow?.qtyOnHand} {countRow?.unit}
              </p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="count-qty" className={LABEL}>
                  จำนวนที่นับได้
                </label>
                <input
                  id="count-qty"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={countQty}
                  onChange={(e) => setCountQty(e.target.value)}
                  disabled={counting}
                  className={FIELD}
                />
                {variance !== null && countRow ? (
                  <p
                    className={`text-meta ${
                      variance < 0 ? "text-danger" : variance > 0 ? "text-action" : "text-ink-muted"
                    }`}
                  >
                    ส่วนต่าง {variance > 0 ? "+" : ""}
                    {variance} {countRow.unit}
                    {variance < 0 ? " (ขาด)" : variance > 0 ? " (เกิน)" : " (ตรงกัน)"}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="count-note" className={LABEL}>
                  หมายเหตุ (ถ้ามี)
                </label>
                <input
                  id="count-note"
                  type="text"
                  value={countNote}
                  maxLength={1000}
                  onChange={(e) => setCountNote(e.target.value)}
                  disabled={counting}
                  className={FIELD}
                />
              </div>

              {countError ? (
                <div role="alert" className={INLINE_ERROR}>
                  {countError}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCountRow(null)}
                  className={BUTTON_SECONDARY}
                >
                  ยกเลิก
                </button>
                <button type="submit" disabled={!countValid || counting} className={BUTTON_PRIMARY}>
                  {counting ? "กำลังบันทึก…" : "บันทึกการนับ"}
                </button>
              </div>
            </form>
          </BottomSheet>
        </>
      ) : (
        <p className="text-ink-secondary text-body">เลือกโครงการเพื่อดูสต๊อกและรับเข้า</p>
      )}
    </div>
  );
}
