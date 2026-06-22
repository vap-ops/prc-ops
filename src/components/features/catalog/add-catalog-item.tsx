"use client";

// Spec 175 U2 — "add item" to the catalog. 'use client' justified: sheet open
// state, the unit free-text reveal, submit pending, inline error, router.refresh
// after the item is created. The createCatalogItem action + the SECURITY DEFINER
// create_catalog_item RPC carry the role gate + identity uniqueness.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { ITEM_CATEGORY_LABEL } from "@/lib/i18n/labels";
import { COMMON_UNITS, UNIT_OTHER_VALUE } from "@/lib/purchasing/units";
import type { Database } from "@/lib/db/database.types";
import { createCatalogItem } from "@/app/catalog/actions";

type ItemCategory = Database["public"]["Enums"]["item_category"];
const CATEGORIES = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function AddCatalogItem() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [baseItem, setBaseItem] = useState("");
  const [specAttrs, setSpecAttrs] = useState("");
  const [unitChoice, setUnitChoice] = useState("");
  const [unitOther, setUnitOther] = useState("");
  const [stockable, setStockable] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const resolvedUnit = unitChoice === UNIT_OTHER_VALUE ? unitOther.trim() : unitChoice;
  const canSubmit = category !== "" && baseItem.trim() !== "" && resolvedUnit !== "" && !submitting;

  function reset() {
    setCategory("");
    setBaseItem("");
    setSpecAttrs("");
    setUnitChoice("");
    setUnitOther("");
    setStockable(true);
    setNote("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await createCatalogItem({
        category,
        baseItem,
        specAttrs,
        unit: resolvedUnit,
        stockable,
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
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
        เพิ่มวัสดุ
      </button>

      <BottomSheet open={open} title="เพิ่มรายการวัสดุ" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-category" className={LABEL}>
              หมวดหมู่
            </label>
            <select
              id="ci-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">เลือกหมวดหมู่</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ITEM_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-base" className={LABEL}>
              ชื่อวัสดุ
            </label>
            <input
              id="ci-base"
              type="text"
              value={baseItem}
              maxLength={200}
              onChange={(e) => setBaseItem(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น เหล็กข้ออ้อย"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-spec" className={LABEL}>
              สเปก / รายละเอียด (ถ้ามี)
            </label>
            <input
              id="ci-spec"
              type="text"
              value={specAttrs}
              maxLength={200}
              onChange={(e) => setSpecAttrs(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น 12 มิล"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-unit" className={LABEL}>
              หน่วยนับ
            </label>
            <select
              id="ci-unit"
              value={unitChoice}
              onChange={(e) => setUnitChoice(e.target.value)}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">เลือกหน่วยนับ</option>
              {COMMON_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
              <option value={UNIT_OTHER_VALUE}>อื่น ๆ (ระบุเอง)</option>
            </select>
          </div>

          {unitChoice === UNIT_OTHER_VALUE && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ci-unit-other" className={LABEL}>
                ระบุหน่วยนับ
              </label>
              <input
                id="ci-unit-other"
                type="text"
                value={unitOther}
                maxLength={40}
                onChange={(e) => setUnitOther(e.target.value)}
                disabled={submitting}
                className={FIELD}
                placeholder="พิมพ์หน่วยนับเอง"
              />
            </div>
          )}

          <label htmlFor="ci-stockable" className="flex items-center gap-2">
            <input
              id="ci-stockable"
              type="checkbox"
              checked={stockable}
              onChange={(e) => setStockable(e.target.checked)}
              disabled={submitting}
              className="size-5"
            />
            <span className="text-ink text-sm">เก็บสต๊อกในคลัง</span>
            <span className="text-ink-muted text-xs">(ไม่เลือก = สั่งตรงเข้างาน)</span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-note" className={LABEL}>
              หมายเหตุ (ถ้ามี)
            </label>
            <input
              id="ci-note"
              type="text"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              className={FIELD}
            />
          </div>

          {error && (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังเพิ่ม…" : "เพิ่มรายการ"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
