"use client";

// Spec 385 U3b — the ทะเบียน default-rate setter. Copy-shape of SetDailyRate
// (spec 202) at the SKU grain: the default a new unit inherits at pick time
// (U2 copies it → daily_rate via the audited item RPC). MONEY — the page reads
// the current values via the admin client (the whole catalog page is the
// back-office money audience) and every write goes through the DEFINER
// set_equipment_catalog_default_rate RPC. Setting a default affects FUTURE
// picks only; existing units keep their own daily_rate.
//
// 'use client' justification: a toggle + numeric input with busy/error state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Banknote } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { FIELD_INPUT, BUTTON_PRIMARY_COMPACT, INLINE_ERROR } from "@/lib/ui/classes";
import { bahtWithSymbol } from "@/lib/format";
import { setEquipmentCatalogDefaultRate } from "@/app/equipment/actions";
import { EQUIPMENT_DAILY_RATE_LABEL, EQUIPMENT_SET_DAILY_RATE_LABEL } from "@/lib/i18n/labels";

export function SetCatalogDefaultRate({
  skuId,
  currentRate,
}: {
  skuId: string;
  currentRate: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentRate === null ? "" : String(currentRate));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function openSheet() {
    // Resync from the row's CURRENT truth — after a router.refresh picked up
    // another actor's rate, an open seeded at mount time would silently revert
    // it on บันทึก (review find, 2026-07-31).
    setValue(currentRate === null ? "" : String(currentRate));
    setError(null);
    setOpen(true);
  }

  function close() {
    setError(null);
    setValue(currentRate === null ? "" : String(currentRate));
    setOpen(false);
  }

  function handleSave() {
    const rate = Number(value);
    if (value.trim() === "" || !Number.isFinite(rate) || rate < 0) {
      setError("กรอกค่าเช่าต่อวันเป็นตัวเลข (ไม่ติดลบ)");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await setEquipmentCatalogDefaultRate({ id: skuId, rate });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="text-action inline-flex min-h-11 items-center gap-1 text-sm font-medium hover:underline"
      >
        <Banknote aria-hidden className="size-4" />
        {currentRate === null
          ? EQUIPMENT_SET_DAILY_RATE_LABEL
          : `${bahtWithSymbol(currentRate)}/วัน`}
      </button>
      <BottomSheet open={open} title={EQUIPMENT_SET_DAILY_RATE_LABEL} onClose={close}>
        <p className="text-ink-secondary text-sm">
          ค่าเริ่มต้นสำหรับเครื่องใหม่ที่เพิ่มจากทะเบียนรายการนี้ — เครื่องเดิมไม่เปลี่ยน
        </p>
        <label className="text-ink-secondary mt-2 block text-sm">
          {EQUIPMENT_DAILY_RATE_LABEL}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            className={FIELD_INPUT}
            aria-label={EQUIPMENT_DAILY_RATE_LABEL}
          />
        </label>
        {error ? (
          <p role="alert" className={INLINE_ERROR}>
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
        >
          {saving ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </BottomSheet>
    </>
  );
}
