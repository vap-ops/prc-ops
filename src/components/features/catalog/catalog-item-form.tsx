"use client";

// Spec 175 U3 — the shared catalog-item field set, used by both add (U2) and
// edit (U3) so the form never drifts between the two. Owns field state + the
// unit free-text reveal + submit pending + inline error. The caller owns the
// sheet + which action runs (onSubmit) + what happens after success (onSuccess).

import { useState, useTransition } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { ITEM_CATEGORY_LABEL } from "@/lib/i18n/labels";
import { COMMON_UNITS, UNIT_OTHER_VALUE } from "@/lib/purchasing/units";
import type { Database } from "@/lib/db/database.types";

type ItemCategory = Database["public"]["Enums"]["item_category"];
const CATEGORIES = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];

export type CatalogItemValues = {
  category: string;
  baseItem: string;
  specAttrs: string;
  unit: string;
  stockable: boolean;
  note: string;
};

export type CatalogFormResult = { ok: true } | { ok: false; error: string };

export const EMPTY_CATALOG_VALUES: CatalogItemValues = {
  category: "",
  baseItem: "",
  specAttrs: "",
  unit: "",
  stockable: true,
  note: "",
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function CatalogItemForm({
  initial,
  submitLabel,
  submittingLabel,
  onSubmit,
  onSuccess,
  onCancel,
  extra,
}: {
  initial: CatalogItemValues;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: CatalogItemValues) => Promise<CatalogFormResult>;
  onSuccess: () => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  // A seeded unit that isn't in COMMON_UNITS (e.g. วง / ฝา / ตู้) opens as the
  // free-text "other" so editing preserves it.
  const initUnitIsCommon = initial.unit !== "" && COMMON_UNITS.includes(initial.unit);
  const [category, setCategory] = useState(initial.category);
  const [baseItem, setBaseItem] = useState(initial.baseItem);
  const [specAttrs, setSpecAttrs] = useState(initial.specAttrs);
  const [unitChoice, setUnitChoice] = useState(
    initial.unit === "" ? "" : initUnitIsCommon ? initial.unit : UNIT_OTHER_VALUE,
  );
  const [unitOther, setUnitOther] = useState(initUnitIsCommon ? "" : initial.unit);
  const [stockable, setStockable] = useState(initial.stockable);
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const resolvedUnit = unitChoice === UNIT_OTHER_VALUE ? unitOther.trim() : unitChoice;
  const canSubmit = category !== "" && baseItem.trim() !== "" && resolvedUnit !== "" && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await onSubmit({
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
      onSuccess();
    });
  }

  return (
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

      <div className="flex items-center justify-between gap-2">
        <div>{extra}</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
            ยกเลิก
          </button>
          <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
