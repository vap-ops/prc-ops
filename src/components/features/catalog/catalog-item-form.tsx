"use client";

// Spec 175 U3 — the shared catalog-item field set (add + edit). Owns field state
// + the unit free-text reveal + submit pending + inline error. Spec 221 U3c — the
// main category is chosen from the managed catalog_categories (by `categoryId`),
// not the item_category enum; the cascading subcategory scopes by category_id.

import { useState, useTransition } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { CATALOG_SUBCATEGORY_LABEL, PRODUCT_CODE_LABEL } from "@/lib/i18n/labels";
import { COMMON_UNITS, UNIT_OTHER_VALUE } from "@/lib/purchasing/units";
import {
  composeProductCode,
  isValidProductCode,
  productCodeTailLength,
} from "@/lib/catalog/validate";
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
// Spec 221 U4 — the read-only derived product-code prefix shown before the tail.
const CODE_PREFIX_BADGE =
  "rounded-control border-edge-strong bg-card text-ink-muted shadow-input inline-flex shrink-0 items-center border px-3 py-2 text-sm font-mono tabular-nums";

// Spec 221 U4 — seed the editable tail from an existing 6-digit code by stripping
// the prefix the chosen taxonomy derives (category code [+ subcategory code]).
function initialProductCodeTail(
  initial: CatalogItemValues,
  categories: CatalogCategoryOption[],
  subcategories: CatalogSubcategoryOption[],
): string {
  if (initial.productCode.length !== 6) return "";
  const cat = categories.find((c) => c.id === initial.categoryId);
  if (!cat) return "";
  const subLen =
    initial.subcategoryId === ""
      ? 0
      : (subcategories.find((s) => s.id === initial.subcategoryId)?.code.length ?? 0);
  return initial.productCode.slice(cat.code.length + subLen);
}

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
  const [subcategoryId, setSubcategoryId] = useState(initial.subcategoryId);
  // Spec 221 U4 — the user types only the sequence "tail"; the prefix is derived.
  const [tail, setTail] = useState(() =>
    initialProductCodeTail(initial, categories, subcategories),
  );
  // Spec 221 U4 — only RE-compose the stored code once the user actually touches
  // the sequence or the taxonomy. Until then keep the existing code verbatim, so
  // an unrelated edit (e.g. a name change) never silently rewrites a code whose
  // stored prefix predates this scheme (spec 214 allowed free 6-digit codes).
  const [codeEdited, setCodeEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  // Spec 219/221 — the picker offers only the chosen category's subcategories.
  const availableSubs = subcategories.filter((s) => s.categoryId === categoryId);
  const resolvedUnit = unitChoice === UNIT_OTHER_VALUE ? unitOther.trim() : unitChoice;

  // Spec 221 U4 — the product code is composed from the chosen taxonomy: the
  // prefix is the category code (+ the subcategory code when one is chosen); the
  // user enters only the trailing sequence.
  const catCode = categories.find((c) => c.id === categoryId)?.code ?? "";
  const subCode =
    subcategoryId === "" ? "" : (subcategories.find((s) => s.id === subcategoryId)?.code ?? "");
  const codePrefix = catCode + subCode;
  const tailLen = productCodeTailLength(catCode, subCode);
  const composedCode = composeProductCode(catCode, subCode, tail);
  // Preserve the stored code until the user edits it; then submit the composition.
  const productCode = codeEdited ? composedCode : initial.productCode;
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
        productCode,
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
            // Changing the main category invalidates any chosen subcategory and
            // the typed sequence (the derived prefix — and its length — changed).
            setCategoryId(e.target.value);
            setSubcategoryId("");
            setTail("");
            setCodeEdited(true);
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
            onChange={(e) => {
              // A subcategory adds 2 prefix digits → the tail length changes; reset it.
              setSubcategoryId(e.target.value);
              setTail("");
              setCodeEdited(true);
            }}
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
        <div className="flex items-stretch gap-2">
          {/* The derived prefix is decorative here — its value + meaning are
              spoken via the input's aria-describedby (ci-code-hint) below. */}
          <span className={CODE_PREFIX_BADGE} aria-hidden="true">
            {codePrefix === "" ? "— —" : codePrefix}
          </span>
          <input
            id="ci-code"
            type="text"
            inputMode="numeric"
            value={tail}
            maxLength={tailLen}
            onChange={(e) => {
              setTail(e.target.value.replace(/[^0-9]/g, ""));
              setCodeEdited(true);
            }}
            disabled={submitting || categoryId === ""}
            className={FIELD}
            placeholder={"0".repeat(tailLen)}
            aria-invalid={!codeValid}
            aria-describedby="ci-code-hint"
          />
        </div>
        <p
          id="ci-code-hint"
          className={codeValid ? "text-ink-muted text-meta" : "text-danger text-meta"}
        >
          {codePrefix === ""
            ? "รหัส 6 หลัก — 2 หลักแรกมาจากหมวดหลักอัตโนมัติ · พิมพ์เฉพาะเลขลำดับท้าย"
            : subCode !== ""
              ? `รหัส 6 หลัก — ขึ้นต้น ${codePrefix} จากหมวดหลัก+หมวดย่อยอัตโนมัติ · พิมพ์เฉพาะ 2 หลักท้าย (ลำดับ)`
              : `รหัส 6 หลัก — ขึ้นต้น ${codePrefix} จากหมวดหลักอัตโนมัติ · พิมพ์เฉพาะ 4 หลักท้าย (ลำดับ)`}
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
