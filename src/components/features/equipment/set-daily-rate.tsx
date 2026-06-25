"use client";

// Spec 202 U1 — per-item equipment daily-rate setter (back-office money audience:
// pm/super/procurement/project_director). The charge-out rate PRC sets per item is
// margin-sensitive money (zero authenticated grant, ADR 0055 decision 6), so the
// page reads it via the admin client and ONLY for the money audience, and it is
// written through setEquipmentDailyRate (→ set_equipment_daily_rate definer). This
// control is rendered only under canManageRegistry, so it never reaches a site_admin
// field session. Setting a rate affects FUTURE check-outs only (the
// daily_rate_snapshot taken at check-out is immutable). Mirrors the catalog
// SetSellRate control.
//
// 'use client' justification: a toggle + numeric input with busy/error state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Banknote } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { FIELD_INPUT, BUTTON_PRIMARY_COMPACT, INLINE_ERROR } from "@/lib/ui/classes";
import { setEquipmentDailyRate } from "@/app/equipment/actions";
import { EQUIPMENT_DAILY_RATE_LABEL, EQUIPMENT_SET_DAILY_RATE_LABEL } from "@/lib/i18n/labels";

export function SetDailyRate({
  itemId,
  currentRate,
}: {
  itemId: string;
  currentRate: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentRate === null ? "" : String(currentRate));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

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
      const result = await setEquipmentDailyRate({ id: itemId, rate });
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
        onClick={() => setOpen(true)}
        className="text-action focus-visible:ring-action inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium focus:outline-none focus-visible:ring-2"
      >
        <Banknote aria-hidden className="size-4" />
        {currentRate === null
          ? EQUIPMENT_SET_DAILY_RATE_LABEL
          : `฿${currentRate.toLocaleString()}/วัน`}
      </button>

      <BottomSheet open={open} title={EQUIPMENT_SET_DAILY_RATE_LABEL} onClose={close}>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-secondary font-medium">
              {EQUIPMENT_DAILY_RATE_LABEL} (บาท/วัน)
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={FIELD_INPUT}
            />
          </label>
          {error && (
            <span role="alert" className={INLINE_ERROR}>
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={BUTTON_PRIMARY_COMPACT}
          >
            {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
