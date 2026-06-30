"use client";

// Spec 237 (ADR 0066 / S10-U2) — the add/edit BOQ line form.
//
// 'use client' justification: this form owns input state across many fields, the
// S1 unit free-text reveal, the S7 ScopedCatalogItemPicker selection state, a
// useTransition pending state, and an inline post-submit error — all transient
// client-only state a Server Component cannot hold. Mirrors CatalogItemForm.
//
// One form drives both ADD (the parent wires `addBoqLine`) and EDIT (prefilled,
// the parent wires `updateBoqLine`). The catalog item is OPTIONAL (D1: a line need
// not be a catalog item) and the picker is passed NO scope → the full catalog (a
// firm-wide template carries no WP work-category context). The work-category is an
// optional <select> over the global work_categories library (S5).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { ScopedCatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import type { CatalogUnitOption } from "@/components/features/catalog/catalog-item-form";
import { COMMON_UNITS, UNIT_OTHER_VALUE } from "@/lib/purchasing/units";
import { Constants, type Database } from "@/lib/db/database.types";
import { BOQ_VARIATION_TYPE_OPTION_LABEL } from "@/lib/i18n/labels";
import type { BoqActionResult } from "@/app/catalog/boq-templates/actions";

type VariationType = Database["public"]["Enums"]["boq_variation_type"];
const VARIATION_TYPES = Constants.public.Enums.boq_variation_type;

// The global work-category library option (S5) for the optional <select>.
export type BoqWorkCategoryOption = { id: string; code: string; name: string; isActive: boolean };

// The fields the parent action receives. The id/boqTemplateId key is supplied by
// the parent (add → boqTemplateId; edit → id), so this carries only the editable
// line fields.
export interface BoqLineFormValues {
  description: string;
  qty: number;
  unit: string;
  catalogItemId: string;
  workCategoryId: string;
  materialRate: number;
  laborRate: number;
  isStandard: boolean;
  variationType: string;
  exclusivityGroup: string;
}

// The submit payload also carries the template id (add) and/or the line id (edit)
// so the action can revalidate the right detail path.
export interface BoqLineSubmitValues extends BoqLineFormValues {
  boqTemplateId: string;
  id?: string;
}

const EMPTY_INITIAL: BoqLineFormValues = {
  description: "",
  qty: 0,
  unit: "",
  catalogItemId: "",
  workCategoryId: "",
  materialRate: 0,
  laborRate: 0,
  isStandard: false,
  variationType: "standard",
  exclusivityGroup: "",
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input placeholder:text-ink-muted focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function BoqLineForm({
  boqTemplateId,
  lineId,
  items,
  categories,
  units,
  workCategories,
  initial,
  onSubmit,
  onSuccess,
  onCancel,
  submitLabel = "บันทึก",
  submittingLabel = "กำลังบันทึก…",
}: {
  boqTemplateId: string;
  /** Edit mode: the line being edited (the payload carries it as `id`). */
  lineId?: string;
  items: PurchaseRequestCatalogItem[];
  categories: { id: string; name: string }[];
  units: CatalogUnitOption[];
  workCategories: BoqWorkCategoryOption[];
  initial?: BoqLineFormValues;
  onSubmit: (values: BoqLineSubmitValues) => Promise<BoqActionResult>;
  onSuccess?: () => void;
  onCancel?: () => void;
  submitLabel?: string;
  submittingLabel?: string;
}) {
  const router = useRouter();
  const start = initial ?? EMPTY_INITIAL;

  // S1 unit picker: COMMON_UNITS is the in-code fallback when no rows are threaded.
  const unitOptions: CatalogUnitOption[] =
    units.length > 0 ? units : COMMON_UNITS.map((u) => ({ code: u, displayName: u }));
  const initUnitIsCommon = start.unit !== "" && unitOptions.some((u) => u.code === start.unit);

  const [description, setDescription] = useState(start.description);
  const [qty, setQty] = useState(start.qty === 0 ? "" : String(start.qty));
  const [unitChoice, setUnitChoice] = useState(
    start.unit === "" ? "" : initUnitIsCommon ? start.unit : UNIT_OTHER_VALUE,
  );
  const [unitOther, setUnitOther] = useState(initUnitIsCommon ? "" : start.unit);
  const [catalogItemId, setCatalogItemId] = useState(start.catalogItemId);
  const [workCategoryId, setWorkCategoryId] = useState(start.workCategoryId);
  const [materialRate, setMaterialRate] = useState(
    start.materialRate === 0 ? "" : String(start.materialRate),
  );
  const [laborRate, setLaborRate] = useState(start.laborRate === 0 ? "" : String(start.laborRate));
  const [isStandard, setIsStandard] = useState(start.isStandard);
  const [variationType, setVariationType] = useState<VariationType>(
    start.variationType as VariationType,
  );
  const [exclusivityGroup, setExclusivityGroup] = useState(start.exclusivityGroup);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const resolvedUnit = unitChoice === UNIT_OTHER_VALUE ? unitOther.trim() : unitChoice;
  const qtyNum = qty.trim() === "" ? NaN : Number(qty);
  const canSubmit =
    description.trim() !== "" &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    resolvedUnit !== "" &&
    !submitting;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await onSubmit({
        boqTemplateId,
        ...(lineId ? { id: lineId } : {}),
        description: description.trim(),
        qty: qtyNum,
        unit: resolvedUnit,
        catalogItemId,
        workCategoryId,
        materialRate: materialRate.trim() === "" ? 0 : Number(materialRate),
        laborRate: laborRate.trim() === "" ? 0 : Number(laborRate),
        isStandard,
        variationType,
        exclusivityGroup: exclusivityGroup.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bl-desc" className={LABEL}>
          รายละเอียด
        </label>
        <input
          id="bl-desc"
          type="text"
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
          className={FIELD}
          placeholder="เช่น งานเทพื้นคอนกรีต"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bl-qty" className={LABEL}>
            จำนวน
          </label>
          <input
            id="bl-qty"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            disabled={submitting}
            className={FIELD}
            placeholder="0"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="bl-unit" className={LABEL}>
            หน่วยนับ
          </label>
          <select
            id="bl-unit"
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
      </div>

      {unitChoice === UNIT_OTHER_VALUE && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bl-unit-other" className={LABEL}>
            ระบุหน่วยนับ
          </label>
          <input
            id="bl-unit-other"
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

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="bl-material" className={LABEL}>
            ค่าวัสดุ/หน่วย
          </label>
          <input
            id="bl-material"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={materialRate}
            onChange={(e) => setMaterialRate(e.target.value)}
            disabled={submitting}
            className={FIELD}
            placeholder="0"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="bl-labor" className={LABEL}>
            ค่าแรง/หน่วย
          </label>
          <input
            id="bl-labor"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={laborRate}
            onChange={(e) => setLaborRate(e.target.value)}
            disabled={submitting}
            className={FIELD}
            placeholder="0"
          />
        </div>
      </div>

      {/* Spec 237 (D1) — OPTIONAL catalog item via the S7 picker, passed NO scope
          → the full catalog (a firm-wide template has no WP work-category context). */}
      <ScopedCatalogItemPicker
        items={items}
        categories={categories}
        selectedId={catalogItemId}
        onSelect={setCatalogItemId}
        onClear={() => setCatalogItemId("")}
        disabled={submitting}
        label="วัสดุ (ถ้ามี)"
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bl-workcat" className={LABEL}>
          หมวดงาน
        </label>
        <select
          id="bl-workcat"
          value={workCategoryId}
          onChange={(e) => setWorkCategoryId(e.target.value)}
          disabled={submitting}
          className={FIELD}
        >
          <option value="">— ไม่ระบุ —</option>
          {workCategories.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} · {w.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bl-variation" className={LABEL}>
          ประเภทรายการ
        </label>
        <select
          id="bl-variation"
          value={variationType}
          onChange={(e) => setVariationType(e.target.value as VariationType)}
          disabled={submitting}
          className={FIELD}
        >
          {VARIATION_TYPES.map((v) => (
            <option key={v} value={v}>
              {BOQ_VARIATION_TYPE_OPTION_LABEL[v]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bl-exclusivity" className={LABEL}>
          กลุ่มทางเลือก (ถ้ามี)
        </label>
        <input
          id="bl-exclusivity"
          type="text"
          value={exclusivityGroup}
          maxLength={100}
          onChange={(e) => setExclusivityGroup(e.target.value)}
          disabled={submitting}
          className={FIELD}
          placeholder="เช่น พื้น-ตัวเลือก"
        />
      </div>

      <label htmlFor="bl-standard" className="flex items-center gap-2">
        <input
          id="bl-standard"
          type="checkbox"
          checked={isStandard}
          onChange={(e) => setIsStandard(e.target.checked)}
          disabled={submitting}
          className="accent-action size-4 shrink-0"
        />
        <span className={LABEL}>รายการมาตรฐาน</span>
      </label>

      {error && (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={BUTTON_SECONDARY}>
            ยกเลิก
          </button>
        )}
        <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
