"use client";

// Spec 175 U3 — the shared catalog-item field set (add + edit). Spec 221 U3c — the
// main category is the managed catalog_categories (by `categoryId`), not the enum.
// Spec 239 U2 (ADR 0066 / C1) — LEARN-BY-DOING redesign of the item form:
//   • Required set is just ชื่อ + หมวดหมู่ + หน่วยนับ. The save button is always
//     enabled and, when a required field is blank, NAMES the missing one (never a
//     greyed dead-end).
//   • Progressive disclosure: everything else lives behind two reveals —
//     "เพิ่มรายละเอียด" (spec · product code · the multi-category control) and
//     "ไม่ใช่วัสดุทั่วไป?" (kind · fulfillment · owner-supplied), each auto-opened
//     when the item already carries a non-default value there (so editing never
//     hides populated data).
//   • Multi-category: an item keeps ONE primary home but can ALSO appear under
//     other categories (secondaryCategoryIds → catalog_item_categories).
//   • In-flow "เพิ่มหมวดหมู่ใหม่…" creates a category without leaving the form.
//   • The subcategory UI is FLATTENED away (0/251 items use it; schema parked) —
//     subcategoryId is carried through untouched.

import { useState, useTransition } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import {
  FULFILLMENT_MODE_LABEL,
  FULFILLMENT_MODE_OPTION_LABEL,
  ITEM_KIND_LABEL,
  ITEM_KIND_OPTION_LABEL,
  OWNER_SUPPLIED_LABEL,
  PRODUCT_CODE_LABEL,
} from "@/lib/i18n/labels";
import { COMMON_UNITS, UNIT_OTHER_VALUE } from "@/lib/purchasing/units";
import {
  composeProductCode,
  isValidProductCode,
  productCodeTailLength,
} from "@/lib/catalog/validate";
import type { Database } from "@/lib/db/database.types";
import type { CatalogCategoryOption } from "./catalog-list";

type ItemKind = Database["public"]["Enums"]["catalog_item_kind"];
type FulfillmentMode = Database["public"]["Enums"]["catalog_fulfillment_mode"];

export type CatalogItemValues = {
  // Spec 221 — the chosen primary (canonical) category (catalog_categories.id).
  categoryId: string;
  baseItem: string;
  specAttrs: string;
  unit: string;
  note: string;
  productCode: string;
  // Spec 219 — optional subcategory FK (parked in spec 239 U2: no UI, carried through).
  subcategoryId: string;
  // Spec 224 (ADR 0066 D3) — the catalog item facets. fulfillment_mode is the
  // SSOT for stocking; the RPC derives `stockable` from it (no stockable input).
  kind: ItemKind;
  fulfillmentMode: FulfillmentMode;
  ownerSupplied: boolean;
  // Spec 239 U2 (ADR 0066 / C1) — the SECONDARY categories this item also appears
  // under (catalog_item_categories). The primary (categoryId) is never listed here.
  secondaryCategoryIds: string[];
  // Spec 239 U2-fields — search synonyms + lead time (days). Kept as form strings;
  // the action trims / parses (empty → null / no lead time).
  searchTerms: string;
  leadTimeDays: string;
};

// Spec 223 (ADR 0066) — the structured unit-picker options, loaded by the page
// from catalog_units (active rows). `code` is the value stored on the item, so it
// is what the picker submits as `unit`.
export type CatalogUnitOption = {
  code: string;
  displayName: string;
};

// Spec 219/221 — kept exported for the (parked) subcategory schema + the readers
// that still thread it; the form no longer renders a subcategory control.
export type CatalogSubcategoryOption = {
  id: string;
  categoryId: string;
  code: string;
  name: string;
};

export type CatalogFormResult = { ok: true } | { ok: false; error: string };

// Spec 239 U2 — the in-flow "add a category" handler the form calls when the user
// creates a category without leaving the form. Returns the new id so the form can
// select it immediately.
export type CreateCategoryResult = { ok: true; id: string } | { ok: false; error: string };

export const EMPTY_CATALOG_VALUES: CatalogItemValues = {
  categoryId: "",
  baseItem: "",
  specAttrs: "",
  unit: "",
  note: "",
  productCode: "",
  subcategoryId: "",
  // Spec 224 — sensible defaults: an off-the-shelf material the firm supplies.
  kind: "material",
  fulfillmentMode: "off_shelf",
  ownerSupplied: false,
  secondaryCategoryIds: [],
  searchTerms: "",
  leadTimeDays: "",
};

const ITEM_KINDS = Object.keys(ITEM_KIND_OPTION_LABEL) as ItemKind[];
const FULFILLMENT_MODES = Object.keys(FULFILLMENT_MODE_OPTION_LABEL) as FulfillmentMode[];
const ADD_CATEGORY_VALUE = "__add_category__";

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";
// Spec 221 U4 — the read-only derived product-code prefix shown before the tail.
const CODE_PREFIX_BADGE =
  "rounded-control border-edge-strong bg-card text-ink-muted shadow-input inline-flex shrink-0 items-center border px-3 py-2 text-sm font-mono tabular-nums";
const DISCLOSURE_BUTTON =
  "text-action flex items-center gap-1 text-sm font-medium focus-visible:ring-action rounded-md focus:outline-none focus-visible:ring-2";

// Spec 221 U4 — seed the editable tail from an existing 6-digit code by stripping
// the category-code prefix (subcategory is flattened away in spec 239 U2).
function initialProductCodeTail(
  initial: CatalogItemValues,
  categories: CatalogCategoryOption[],
): string {
  if (initial.productCode.length !== 6) return "";
  const cat = categories.find((c) => c.id === initial.categoryId);
  if (!cat) return "";
  return initial.productCode.slice(cat.code.length);
}

export function CatalogItemForm({
  initial,
  categories = [],
  units = [],
  submitLabel,
  submittingLabel,
  onSubmit,
  onSuccess,
  onCancel,
  onCreateCategory,
  extra,
}: {
  initial: CatalogItemValues;
  categories?: CatalogCategoryOption[];
  units?: CatalogUnitOption[];
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (values: CatalogItemValues) => Promise<CatalogFormResult>;
  onSuccess: () => void;
  onCancel: () => void;
  // Spec 239 U2 — when provided, the category picker offers an in-flow "add" option.
  onCreateCategory?: (input: { code: string; name: string }) => Promise<CreateCategoryResult>;
  extra?: React.ReactNode;
}) {
  // Spec 223 (ADR 0066) — the picker options come from the managed catalog_units
  // (threaded from the page loader; the table is the SSOT). COMMON_UNITS is the
  // historical seed-of-record kept as the in-code fallback when no rows are threaded.
  const unitOptions: CatalogUnitOption[] =
    units.length > 0 ? units : COMMON_UNITS.map((u) => ({ code: u, displayName: u }));
  const initUnitIsCommon = initial.unit !== "" && unitOptions.some((u) => u.code === initial.unit);

  // Spec 239 U2 — categories created in-flow are appended locally so they can be
  // selected immediately (the page re-fetches on the next refresh).
  const [extraCategories, setExtraCategories] = useState<CatalogCategoryOption[]>([]);
  const allCategories = [...categories, ...extraCategories];

  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [baseItem, setBaseItem] = useState(initial.baseItem);
  const [specAttrs, setSpecAttrs] = useState(initial.specAttrs);
  const [unitChoice, setUnitChoice] = useState(
    initial.unit === "" ? "" : initUnitIsCommon ? initial.unit : UNIT_OTHER_VALUE,
  );
  const [unitOther, setUnitOther] = useState(initUnitIsCommon ? "" : initial.unit);
  const [note, setNote] = useState(initial.note);
  // Spec 239 U2-fields — search synonyms + lead time (kept as form strings).
  const [searchTerms, setSearchTerms] = useState(initial.searchTerms);
  const [leadTimeDays, setLeadTimeDays] = useState(initial.leadTimeDays);
  // Spec 224 (ADR 0066 D3) — the catalog item facets.
  const [kind, setKind] = useState<ItemKind>(initial.kind);
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>(initial.fulfillmentMode);
  const [ownerSupplied, setOwnerSupplied] = useState(initial.ownerSupplied);
  // Spec 239 U2 — secondary memberships (the primary is held separately).
  const [secondaryCategoryIds, setSecondaryCategoryIds] = useState<string[]>(
    initial.secondaryCategoryIds.filter((id) => id !== initial.categoryId),
  );
  // Spec 221 U4 — the user types only the sequence "tail"; the prefix is derived.
  const [tail, setTail] = useState(() => initialProductCodeTail(initial, categories));
  // Spec 221 U4 — only RE-compose the stored code once the user touches the
  // sequence or the category. Until then keep the existing code verbatim.
  const [codeEdited, setCodeEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  // Spec 239 U2 — the two progressive-disclosure reveals. Auto-open when the item
  // already carries a value there, so an edit never hides populated data.
  const [detailsOpen, setDetailsOpen] = useState(
    initial.specAttrs !== "" ||
      initial.productCode !== "" ||
      initial.searchTerms !== "" ||
      initial.leadTimeDays !== "" ||
      initial.secondaryCategoryIds.some((id) => id !== initial.categoryId),
  );
  const [advancedOpen, setAdvancedOpen] = useState(
    initial.kind !== "material" || initial.fulfillmentMode !== "off_shelf" || initial.ownerSupplied,
  );

  // Spec 239 U2 — the in-flow add-category mini-form.
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatCode, setNewCatCode] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatError, setNewCatError] = useState<string | null>(null);
  const [creatingCategory, startCreateCategory] = useTransition();

  const resolvedUnit = unitChoice === UNIT_OTHER_VALUE ? unitOther.trim() : unitChoice;

  // Spec 221 U4 / 239 U2 — the product code prefix is the category's 2-digit code
  // (subcategory flattened away); the user enters only the trailing sequence.
  const catCode = allCategories.find((c) => c.id === categoryId)?.code ?? "";
  const codePrefix = catCode;
  const tailLen = productCodeTailLength(catCode, "");
  const composedCode = composeProductCode(catCode, "", tail);
  // Preserve the stored code until the user edits it; then submit the composition.
  const productCode = codeEdited ? composedCode : initial.productCode;
  const codeValid = isValidProductCode(productCode);

  // Spec 239 U2 — the save button is ALWAYS live; clicking with a blank required
  // field NAMES it rather than dead-ending on a greyed control.
  const missingMessage =
    categoryId === ""
      ? "เลือกหมวดหมู่ก่อนบันทึก"
      : baseItem.trim() === ""
        ? "กรอกชื่อวัสดุก่อนบันทึก"
        : resolvedUnit === ""
          ? "เลือกหน่วยนับก่อนบันทึก"
          : !codeValid
            ? "รหัสสินค้าต้องเป็นตัวเลข 6 หลัก"
            : null;

  function toggleSecondary(id: string) {
    setSecondaryCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleCreateCategory() {
    if (!onCreateCategory) return;
    const code = newCatCode.trim();
    const name = newCatName.trim();
    if (!/^[0-9]{2}$/.test(code)) {
      setNewCatError("รหัสหมวดหลักต้องเป็นตัวเลข 2 หลัก");
      return;
    }
    if (name === "") {
      setNewCatError("กรอกชื่อหมวดหลัก");
      return;
    }
    setNewCatError(null);
    startCreateCategory(async () => {
      const result = await onCreateCategory({ code, name });
      if (!result.ok) {
        setNewCatError(result.error);
        return;
      }
      const created: CatalogCategoryOption = { id: result.id, code, name };
      setExtraCategories((prev) => [...prev, created]);
      setCategoryId(result.id);
      setTail("");
      setCodeEdited(true);
      setAddingCategory(false);
      setNewCatCode("");
      setNewCatName("");
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (missingMessage) {
      setError(missingMessage);
      return;
    }
    setError(null);
    startSubmit(async () => {
      const result = await onSubmit({
        categoryId,
        baseItem,
        specAttrs,
        unit: resolvedUnit,
        note,
        productCode,
        subcategoryId: initial.subcategoryId,
        kind,
        fulfillmentMode,
        ownerSupplied,
        secondaryCategoryIds: secondaryCategoryIds.filter((id) => id !== categoryId),
        searchTerms,
        leadTimeDays,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess();
    });
  }

  // The categories available as SECONDARY memberships (all but the chosen primary).
  const secondaryChoices = allCategories.filter((c) => c.id !== categoryId);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* ---- Required: หมวดหมู่ ---- */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ci-category" className={LABEL}>
          หมวดหมู่
        </label>
        <select
          id="ci-category"
          value={categoryId}
          onChange={(e) => {
            if (e.target.value === ADD_CATEGORY_VALUE) {
              setAddingCategory(true);
              setNewCatError(null);
              return;
            }
            // Changing the primary invalidates the typed sequence (the prefix
            // changed) and drops the new primary from the secondary set.
            const next = e.target.value;
            setCategoryId(next);
            setSecondaryCategoryIds((prev) => prev.filter((id) => id !== next));
            setTail("");
            setCodeEdited(true);
          }}
          disabled={submitting}
          className={FIELD}
        >
          <option value="">เลือกหมวดหมู่</option>
          {allCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {onCreateCategory ? (
            <option value={ADD_CATEGORY_VALUE}>➕ เพิ่มหมวดหมู่ใหม่…</option>
          ) : null}
        </select>

        {addingCategory && onCreateCategory ? (
          <div className="border-edge bg-sunk rounded-control mt-1 flex flex-col gap-2 border p-3">
            <div className="flex gap-2">
              <input
                aria-label="รหัสหมวดหมู่ใหม่"
                type="text"
                inputMode="numeric"
                value={newCatCode}
                maxLength={2}
                onChange={(e) => setNewCatCode(e.target.value.replace(/[^0-9]/g, ""))}
                disabled={creatingCategory}
                className={`${FIELD} max-w-20`}
                placeholder="รหัส"
              />
              <input
                aria-label="ชื่อหมวดหมู่ใหม่"
                type="text"
                value={newCatName}
                maxLength={120}
                onChange={(e) => setNewCatName(e.target.value)}
                disabled={creatingCategory}
                className={FIELD}
                placeholder="ชื่อหมวดหมู่ใหม่"
              />
            </div>
            {newCatError ? (
              <span role="alert" className={INLINE_ERROR}>
                {newCatError}
              </span>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddingCategory(false);
                  setNewCatError(null);
                }}
                className={BUTTON_SECONDARY}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleCreateCategory}
                disabled={creatingCategory}
                className={BUTTON_PRIMARY}
              >
                {creatingCategory ? "กำลังเพิ่ม…" : "เพิ่มหมวดหมู่"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- Required: ชื่อวัสดุ ---- */}
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

      {/* ---- Required: หน่วยนับ ---- */}
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
          {unitOptions.map((u) => (
            <option key={u.code} value={u.code}>
              {u.displayName}
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

      {/* ---- Reveal 1: เพิ่มรายละเอียด ---- */}
      <button
        type="button"
        onClick={() => setDetailsOpen((o) => !o)}
        className={DISCLOSURE_BUTTON}
        aria-expanded={detailsOpen}
      >
        {detailsOpen ? "▾" : "▸"} เพิ่มรายละเอียด
      </button>

      {detailsOpen ? (
        <div className="border-edge flex flex-col gap-4 border-l-2 pl-3">
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
              {/* The derived prefix is decorative — its value + meaning are spoken
                  via the input's aria-describedby (ci-code-hint) below. */}
              <span className={CODE_PREFIX_BADGE} aria-hidden="true">
                {codePrefix === "" ? "—" : codePrefix}
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
                ? "รหัส 6 หลัก — 2 หลักแรกมาจากหมวดหมู่อัตโนมัติ · พิมพ์เฉพาะเลขลำดับท้าย"
                : `รหัส 6 หลัก — ขึ้นต้น ${codePrefix} จากหมวดหมู่อัตโนมัติ · พิมพ์เฉพาะ 4 หลักท้าย (ลำดับ)`}
            </p>
          </div>

          {/* Spec 239 U2-fields — search synonyms (alt names) for the catalog search. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-search-terms" className={LABEL}>
              คำค้น / ชื่อเรียกอื่น (ถ้ามี)
            </label>
            <input
              id="ci-search-terms"
              type="text"
              value={searchTerms}
              maxLength={500}
              onChange={(e) => setSearchTerms(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น เหล็กเส้น rebar"
            />
            <p className="text-ink-muted text-meta">
              คั่นหลายคำด้วยช่องว่าง — ช่วยให้ค้นเจอง่ายขึ้น
            </p>
          </div>

          {/* Spec 239 U2-fields — lead time (normal days to procure). */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-lead-time" className={LABEL}>
              ระยะเวลาสั่งซื้อ (วัน) (ถ้ามี)
            </label>
            <input
              id="ci-lead-time"
              type="number"
              inputMode="numeric"
              min={0}
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
              disabled={submitting}
              className={FIELD}
              placeholder="เช่น 7"
            />
          </div>

          {/* Spec 239 U2 — multi-category: also list under other categories. */}
          {secondaryChoices.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className={LABEL}>ปรากฏในหมวดอื่นด้วย (ถ้ามี)</legend>
              <p className="text-ink-muted text-meta">
                หมวดหลักคือบ้านของวัสดุ · เลือกหมวดอื่นเพื่อให้ค้นเจอจากหลายที่
              </p>
              <div className="flex flex-col gap-1.5">
                {secondaryChoices.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={secondaryCategoryIds.includes(c.id)}
                      onChange={() => toggleSecondary(c.id)}
                      disabled={submitting}
                      className="accent-action size-4 shrink-0"
                    />
                    <span className="text-ink text-sm">{c.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

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
        </div>
      ) : null}

      {/* ---- Reveal 2: ไม่ใช่วัสดุทั่วไป? (facets) ---- */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        className={DISCLOSURE_BUTTON}
        aria-expanded={advancedOpen}
      >
        {advancedOpen ? "▾" : "▸"} ไม่ใช่วัสดุทั่วไป?
      </button>

      {advancedOpen ? (
        <div className="border-edge flex flex-col gap-4 border-l-2 pl-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-kind" className={LABEL}>
              {ITEM_KIND_LABEL}
            </label>
            <select
              id="ci-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as ItemKind)}
              disabled={submitting}
              className={FIELD}
            >
              {ITEM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ITEM_KIND_OPTION_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ci-fulfillment" className={LABEL}>
              {FULFILLMENT_MODE_LABEL}
            </label>
            <select
              id="ci-fulfillment"
              value={fulfillmentMode}
              onChange={(e) => setFulfillmentMode(e.target.value as FulfillmentMode)}
              disabled={submitting}
              className={FIELD}
            >
              {FULFILLMENT_MODES.map((m) => (
                <option key={m} value={m}>
                  {FULFILLMENT_MODE_OPTION_LABEL[m]}
                </option>
              ))}
            </select>
          </div>

          <label htmlFor="ci-owner" className="flex items-center gap-2">
            <input
              id="ci-owner"
              type="checkbox"
              checked={ownerSupplied}
              onChange={(e) => setOwnerSupplied(e.target.checked)}
              disabled={submitting}
              className="accent-action size-4 shrink-0"
            />
            <span className={LABEL}>{OWNER_SUPPLIED_LABEL}</span>
          </label>
        </div>
      ) : null}

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
          <button type="submit" disabled={submitting} className={BUTTON_PRIMARY}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
