"use client";

// Spec 361 U8 — add / edit one หน่วยนับ. One sheet for both modes: the create
// arm is also the "promote an off-list string" path (its code arrives
// pre-filled), so a unit typed into an item becomes a managed option without
// retyping it. Edit cannot change the code — `catalog_items.unit` stores the
// code as text (spec 223 keeps the column text on purpose), so a recode would
// orphan every item carrying the old string. Deactivate is the retire path;
// there is no delete.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import {
  createCatalogUnit,
  setCatalogUnitActive,
  updateCatalogUnit,
} from "@/app/catalog/units/actions";
import type { ManagedUnitUsage, UnitClass } from "@/lib/catalog/units-curation";
import { UNIT_CLASS_LABEL, UNIT_INACTIVE_LABEL } from "@/lib/i18n/labels";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  FIELD_SELECT,
  FIELD_STACKED,
  INLINE_ERROR,
} from "@/lib/ui/classes";

const UNIT_CLASSES: readonly UnitClass[] = ["count", "length", "area", "volume", "weight", "trips"];

type Props =
  | { mode: "create"; initialCode: string; onClose: () => void }
  | { mode: "edit"; unit: ManagedUnitUsage; onClose: () => void };

export function UnitSheet(props: Props) {
  const router = useRouter();
  const editing = props.mode === "edit" ? props.unit : null;
  const [code, setCode] = useState(props.mode === "create" ? props.initialCode : props.unit.code);
  const [displayName, setDisplayName] = useState(
    props.mode === "create" ? props.initialCode : props.unit.displayName,
  );
  const [abbrShort, setAbbrShort] = useState(editing?.abbrShort ?? "");
  const [unitClass, setUnitClass] = useState<UnitClass>(editing?.unitClass ?? "count");
  const [sortOrder, setSortOrder] = useState(String(editing?.sortOrder ?? 0));
  const [error, setError] = useState<string | null>(null);
  // Retiring a unit that items still carry pulls it out of the picker under
  // them, so that case asks twice; retiring an unused one does not.
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [busy, startWrite] = useTransition();

  const canSubmit = code.trim() !== "" && displayName.trim() !== "" && !busy;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startWrite(async () => {
      const input = {
        code: code.trim(),
        displayName: displayName.trim(),
        // Always sent: update_catalog_unit assigns abbr_short unconditionally,
        // so omitting it wipes the stored abbreviation on every edit.
        abbrShort: abbrShort.trim() === "" ? null : abbrShort.trim(),
        unitClass,
        sortOrder: sortOrder.trim() === "" ? 0 : Number(sortOrder),
      };
      const result =
        props.mode === "create" ? await createCatalogUnit(input) : await updateCatalogUnit(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      props.onClose();
      router.refresh();
    });
  }

  function handleToggleActive() {
    if (editing === null) return;
    if (editing.isActive && editing.usage > 0 && !confirmRetire) {
      setConfirmRetire(true);
      return;
    }
    setError(null);
    startWrite(async () => {
      const result = await setCatalogUnitActive({
        code: editing.code,
        isActive: !editing.isActive,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      props.onClose();
      router.refresh();
    });
  }

  return (
    <BottomSheet
      open
      title={props.mode === "create" ? "เพิ่มหน่วยนับ" : `แก้ไข ${editing?.displayName}`}
      onClose={props.onClose}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="text-ink-secondary block text-sm">
          หน่วย
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              // Create mode: the name follows the code until it is edited apart.
              if (props.mode === "create" && displayName === code) setDisplayName(e.target.value);
            }}
            disabled={props.mode === "edit"}
            className={FIELD_STACKED}
          />
        </label>
        {props.mode === "edit" && (
          <p className="text-ink-secondary text-meta">
            เปลี่ยนชื่อหน่วยได้ แต่เปลี่ยนรหัสหน่วยไม่ได้ — วัสดุที่ใช้หน่วยนี้อ้างอิงรหัสเดิมอยู่
          </p>
        )}

        <label className="text-ink-secondary block text-sm">
          ชื่อที่แสดง
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>

        <label className="text-ink-secondary block text-sm">
          ตัวย่อ (ไม่บังคับ)
          <input
            value={abbrShort}
            onChange={(e) => setAbbrShort(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>

        <label className="text-ink-secondary block text-sm">
          ประเภท
          <select
            value={unitClass}
            onChange={(e) => setUnitClass(e.target.value as UnitClass)}
            className={`${FIELD_SELECT} mt-1`}
          >
            {UNIT_CLASSES.map((c) => (
              <option key={c} value={c}>
                {UNIT_CLASS_LABEL[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-ink-secondary block text-sm">
          ลำดับการแสดง
          <input
            type="number"
            inputMode="numeric"
            step="1"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>

        {editing !== null && (
          <p className="text-ink-secondary text-meta">
            มีวัสดุใช้หน่วยนี้อยู่ {editing.usage} รายการ
          </p>
        )}
        {confirmRetire && (
          <p role="alert" className="text-attn-press text-meta">
            ปิดใช้งานแล้วจะเลือกหน่วยนี้กับวัสดุใหม่ไม่ได้ (วัสดุเดิมยังคงหน่วยเดิมไว้) —
            กดอีกครั้งเพื่อยืนยัน
          </p>
        )}
        {error && (
          <span role="alert" className={INLINE_ERROR}>
            {error}
          </span>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
          {editing !== null && (
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={busy}
              className={BUTTON_SECONDARY}
            >
              {editing.isActive
                ? confirmRetire
                  ? "ยืนยันปิดใช้งาน"
                  : UNIT_INACTIVE_LABEL
                : "เปิดใช้งาน"}
            </button>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}
