"use client";

// Spec 178 B2 — the site_admin stock-count surface. site_admin physically keeps
// the on-site store but cannot reach /store (BACK_OFFICE-gated). The
// record_stock_count RPC is SITE_STAFF-gated, so this focused, count-ONLY surface
// gives them the missing UI: pick a project → see its on-hand → ตรวจนับ each item
// (counted qty + live variance preview) → record_stock_count. No รับเข้า / เบิก /
// reversal here (those stay on /store for the back office). Self-governance: the
// person holding the store reconciles it. 'use client': picker nav + sheet state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { recordStockCount } from "@/app/store/actions";
import { FULL_STOCKTAKE_LABEL } from "@/lib/i18n/labels";

export type CountStockRow = {
  catalogItemId: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qtyOnHand: number;
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function StoreCountManager({
  projects,
  selectedProjectId,
  onHand,
  hidePicker = false,
  collapsible = false,
}: {
  projects: { id: string; code: string; name: string }[];
  selectedProjectId: string | null;
  onHand: CountStockRow[];
  // Spec 197 U2: on the per-project คลัง surface the project comes from the
  // route, so the picker is suppressed (the legacy /stock-count picker is gone).
  hidePicker?: boolean;
  // Spec 197 U2: render this as a ตรวจนับทั้งคลัง full-stocktake panel — the item
  // list stays hidden behind a toggle until the operator opens the count pass,
  // so it does not compete with the per-row spot count already on the surface.
  collapsible?: boolean;
}) {
  const router = useRouter();

  // When collapsible, the full list starts closed behind the ตรวจนับทั้งคลัง
  // toggle; otherwise (the legacy standalone surface) it is always open.
  const [open, setOpen] = useState(!collapsible);
  const [countRow, setCountRow] = useState<CountStockRow | null>(null);
  const [countQty, setCountQty] = useState("");
  const [countNote, setCountNote] = useState("");
  const [countError, setCountError] = useState<string | null>(null);
  const [counting, startCount] = useTransition();

  const countQtyNum = Number(countQty);
  const countValid = countQty !== "" && Number.isFinite(countQtyNum) && countQtyNum >= 0;
  const variance = countRow && countValid ? countQtyNum - countRow.qtyOnHand : null;

  function openCount(row: CountStockRow) {
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

  return (
    <div className="flex flex-col gap-5">
      {hidePicker ? null : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="count-project" className={LABEL}>
            โครงการ
          </label>
          <select
            id="count-project"
            value={selectedProjectId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              router.push(v === "" ? "/stock-count" : `/stock-count?project=${v}`);
            }}
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

      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={BUTTON_SECONDARY}
        >
          {FULL_STOCKTAKE_LABEL}
        </button>
      ) : null}

      {open && selectedProjectId ? (
        onHand.length === 0 ? (
          <p className="text-ink-secondary text-body">ยังไม่มีสต๊อกในคลังของโครงการนี้</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {onHand.map((row) => (
              <li
                key={row.catalogItemId}
                className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-ink text-body block font-semibold">{row.baseItem}</span>
                  <span className="text-ink-secondary text-meta block">
                    {row.specAttrs ? `${row.specAttrs} · ` : ""}
                    ระบบมี {row.qtyOnHand} {row.unit}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => openCount(row)}
                  className={`${BUTTON_SECONDARY} shrink-0`}
                >
                  ตรวจนับ
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      <BottomSheet open={countRow !== null} title="ตรวจนับสต๊อก" onClose={() => setCountRow(null)}>
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
            <button type="button" onClick={() => setCountRow(null)} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!countValid || counting} className={BUTTON_PRIMARY}>
              {counting ? "กำลังบันทึก…" : "บันทึกการนับ"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
