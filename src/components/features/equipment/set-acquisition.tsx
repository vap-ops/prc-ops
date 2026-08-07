"use client";

// Spec 367 §10.4 — per-item acquisition cost + acquired-on (back-office money
// audience only). `acquisition_cost` / `acquired_at` carry zero authenticated
// grant (ADR 0055 decision 6), so the page reads them through the admin client
// for the money audience alone and writes through setEquipmentAcquisition →
// the SECURITY DEFINER `set_equipment_acquisition`. Rendered only under
// canManageRegistry, so it never reaches a site_admin field session.
//
// Mirrors SetDailyRate's shape — same row cluster, same 44px floor, same
// resync-on-open (a sheet seeded at mount silently reverts another actor's
// change after a router.refresh; spec 385 U4's review find).
//
// The one difference: BOTH fields are blankable and blank CLEARS. Correcting a
// wrong figure to "unknown" is a real need, and a separate clear verb would be
// a second way to say one thing.
//
// 'use client' justification: a sheet toggle plus two inputs with busy/error state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Receipt } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { FIELD_INPUT, BUTTON_PRIMARY_COMPACT, INLINE_ERROR } from "@/lib/ui/classes";
import { setEquipmentAcquisition } from "@/app/equipment/actions";
import {
  EQUIPMENT_ACQUIRED_AT_LABEL,
  EQUIPMENT_ACQUISITION_COST_LABEL,
  EQUIPMENT_SET_ACQUISITION_LABEL,
} from "@/lib/i18n/labels";

export function SetAcquisition({
  itemId,
  currentCost,
  currentAcquiredAt,
}: {
  itemId: string;
  currentCost: number | null;
  currentAcquiredAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState(currentCost === null ? "" : String(currentCost));
  const [acquiredAt, setAcquiredAt] = useState(currentAcquiredAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function syncFromProps() {
    setCost(currentCost === null ? "" : String(currentCost));
    setAcquiredAt(currentAcquiredAt ?? "");
  }

  function openSheet() {
    syncFromProps();
    setError(null);
    setOpen(true);
  }

  function close() {
    setError(null);
    syncFromProps();
    setOpen(false);
  }

  function handleSave() {
    setError(null);
    startSave(async () => {
      const result = await setEquipmentAcquisition({ id: itemId, cost, acquiredAt });
      if (!result.ok) {
        // Keep the sheet open: every refusal here is fixable in the field the
        // operator is already looking at.
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
        className="text-action focus-visible:ring-action text-meta inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md font-medium focus:outline-none focus-visible:ring-2"
      >
        <Receipt aria-hidden className="size-4" />
        {/* An unrecorded cost says so — rendering ฿0 would assert a price nobody
            entered (honest copy applied to an empty state). And the SET state
            keeps the word: this control sits beside SetDailyRate in the same row
            cluster, so a bare `฿12,500` next to `฿300/วัน` is two money figures
            with nothing saying which is which — worst for a screen reader, where
            the visual grouping does not exist at all. */}
        {currentCost === null
          ? EQUIPMENT_SET_ACQUISITION_LABEL
          : `${EQUIPMENT_ACQUISITION_COST_LABEL} ฿${currentCost.toLocaleString()}`}
      </button>

      <BottomSheet open={open} title={EQUIPMENT_SET_ACQUISITION_LABEL} onClose={close}>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-secondary font-medium">
              {EQUIPMENT_ACQUISITION_COST_LABEL} (บาท)
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className={FIELD_INPUT}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-secondary font-medium">
              {EQUIPMENT_ACQUIRED_AT_LABEL}
            </span>
            <input
              type="date"
              value={acquiredAt}
              onChange={(e) => setAcquiredAt(e.target.value)}
              className={FIELD_INPUT}
            />
          </label>
          <p className="text-meta text-ink-secondary">เว้นว่างไว้เพื่อล้างค่าที่บันทึกไว้</p>
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
