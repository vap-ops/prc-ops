"use client";

// Spec 175 U3 — the shared catalog-item field set (add + edit). Owns field state
// + the unit free-text reveal + submit pending + inline error. Spec 221 U3c — the
// main category is chosen from the managed catalog_categories (by `categoryId`),
// not the item_category enum; the cascading subcategory scopes by category_id.

import { useState, useTransition } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { CATALOG_SUBCATEGORY_LABEL, PRODUCT_CODE_LABEL } from "@/lib/i18n/labels";
import { COMMON_UNITS, UNIT_OTHER_VALUE } from "@/lib/purchasing/units";
import { isValidProductCode } from "@/lib/catalog/validate";
import type { CatalogCategoryOption } from "./catalog-list";

export type CatalogItemValues = {
  // Spec 221 — the chosen main category (catalog_categories.id).
  categoryId: string;
  baseItem: string;
  specAttrs: string;
  unit: string;
  note: string;
  productCode: string;
  // Spec 219 — optional subcategory FK (empty = none).
  subcategoryId: string;
};

// Spec 219/221 — the subcategory options the cascading picker scopes to the
// chosen category (by category_id). Loaded by the page from catalog_subcategories.
export type CatalogSubcategoryOption = {
  id: string;
  categoryId: string;
  code: string;
  name: string;
};

export type CatalogFormResult = { ok: true } | { ok: false; error: string };

export const EMPTY_CATALOG_VALUES: CatalogItemValues = {
  categoryId: "",
  baseItem: "",
  specAttrs: "",
  unit: "",
  note: "",
  productCode: "",
  subcategoryId: "",
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function CatalogItemForm({
  initial,
  categories = [],
  subcategories = [],
  submitLabel,
  submittingLabel,
  onSubmit,
  onSuccess,
  onCancel,
  extra,
}: {
  initial: CatalogItemValues;
  categories?: CatalogCategoryOption[];
  subcategories?: CatalogSubcategoryOption[];
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: CatalogItemValues) => Promise<CatalogFormResult>;
  onSuccess: () => void;
  onCancel: () => void;
  extra?: React.ReactNode;
}) {
  const initUnitIsCommon = initial.unit !== "" && COMMON_UNITS.includes(initial.unit);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [baseItem, setBaseItem] = useState(initial.baseItem);
  const [specAttrs, setSpecAttrs] = useState(initial.specAttrs);
  const [unitChoice, setUnitChoice] = useState(
    initial.unit === "" ? "" : initUnitIsCommon ? initial.unit : UNIT_OTHER_VALUE,
  );
  const [unitOther, setUnitOther] = useState(initUnitIsCommon ? "" : initial.unit);
  const [note, setNote] = useState(initial.note);
  const [productCode, setProductCode] = useState(initial.productCode);
  const [subcategoryId, setSubcategoryId] = useState(initial.subcategoryId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  // Spec 219/221 — the picker offers only the chosen category's subcategories.
  const availableSubs = subcategories.filter((s) => s.categoryId === categoryId);
  const resolvedUnit = unitChoice === UNIT_OTHER_VALUE ? unitOther.trim() : unitChoice;
  const codeValid = isValidProductCode(productCode);
  const canSubmit =
    categoryId !== "" && baseItem.trim() !== "" && resolvedUnit !== "" && codeValid && !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await onSubmit({
        categoryId,
        baseItem,
        specAttrs,
        unit: resolvedUnit,
        note,
        productCode: productCode.trim(),
        subcategoryId,
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
          value={categoryId}
          onChange={(e) => {
            // Changing the main category invalidates any chosen subcategory.
            setCategoryId(e.target.value);
            setSubcategoryId("");
          }}
          disabled={submitting}
          className={FIELD}
        >
          <option value="">เลือกหมวดหมู่</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {availableSubs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ci-subcategory" className={LABEL}>
            {CATALOG_SUBCATEGORY_LABEL}
          </label>
          <select
            id="ci-subcategory"
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={submitting}
            className={FIELD}
          >
            <option value="">— ไม่ระบุ —</option>
            {availableSubs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
        <label htmlFor="ci-code" className={LABEL}>
          {PRODUCT_CODE_LABEL} (ถ้ามี)
        </label>
        <input
          id="ci-code"
          type="text"
          inputMode="numeric"
          value={productCode}
          maxLength={6}
          onChange={(e) => setProductCode(e.target.value.replace(/[^0-9]/g, ""))}
          disabled={submitting}
          className={FIELD}
          placeholder="เช่น 010120"
          aria-invalid={!codeValid}
        />
        <p className={codeValid ? "text-ink-muted text-meta" : "text-danger text-meta"}>
          6 หลัก — 2 หลักแรกหมวดหลัก · 2 หลักถัดไปหมวดย่อย · 2 หลักท้ายลำดับ
        </p>
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
