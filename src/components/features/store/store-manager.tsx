"use client";

// Spec 177 U2 — the /store surface. A back-office user picks a project, sees its
// on-hand stock (qty + value + derived moving-average cost), and records a
// stock-in (รับเข้า) of a catalog item at cost. 'use client': the project
// selector navigation, the record-sheet state, the submit transition + refresh.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { ITEM_CATEGORY_LABEL, STORE_RECEIVE_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";
import { recordStockIn } from "@/app/store/actions";

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

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

// Baht formatter for the cost columns (2dp, thousands separators).
const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function StoreManager({
  projects,
  selectedProjectId,
  onHand,
  catalogItems,
  suppliers,
}: {
  projects: { id: string; code: string; name: string }[];
  selectedProjectId: string | null;
  onHand: StockRow[];
  catalogItems: CatalogPick[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const qtyNum = Number(qty);
  const costNum = Number(unitCost);
  const canSubmit =
    item !== "" &&
    qty !== "" &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    unitCost !== "" &&
    Number.isFinite(costNum) &&
    costNum >= 0 &&
    !submitting;

  const categories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];

  function reset() {
    setItem("");
    setQty("");
    setUnitCost("");
    setSupplier("");
    setNote("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || !selectedProjectId) return;
    setError(null);
    startSubmit(async () => {
      const result = await recordStockIn({
        projectId: selectedProjectId,
        catalogItemId: item,
        qty: qtyNum,
        unitCost: costNum,
        supplierId: supplier,
        note,
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
    <div className="flex flex-col gap-4">
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

      {selectedProjectId ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-ink text-body font-semibold">สต๊อกในมือ</h2>
            <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY}>
              {STORE_RECEIVE_LABEL}
            </button>
          </div>

          {onHand.length === 0 ? (
            <p className="text-ink-secondary text-body">ยังไม่มีสต๊อกในสโตร์</p>
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
                  </li>
                );
              })}
            </ul>
          )}

          <BottomSheet open={open} title={STORE_RECEIVE_LABEL} onClose={() => setOpen(false)}>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="store-item" className={LABEL}>
                  วัสดุ
                </label>
                <select
                  id="store-item"
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
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

              <div className="flex flex-col gap-1.5">
                <label htmlFor="store-qty" className={LABEL}>
                  จำนวน
                </label>
                <input
                  id="store-qty"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  disabled={submitting}
                  className={FIELD}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="store-cost" className={LABEL}>
                  ราคาต้นทุน/หน่วย (บาท)
                </label>
                <input
                  id="store-cost"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  disabled={submitting}
                  className={FIELD}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="store-supplier" className={LABEL}>
                  ผู้ขาย (ถ้ามี)
                </label>
                <select
                  id="store-supplier"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
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
                <label htmlFor="store-note" className={LABEL}>
                  หมายเหตุ (ถ้ามี)
                </label>
                <input
                  id="store-note"
                  type="text"
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={submitting}
                  className={FIELD}
                />
              </div>

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
                  {submitting ? "กำลังบันทึก…" : "บันทึก"}
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
