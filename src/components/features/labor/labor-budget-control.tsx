"use client";

// Spec 205 U2 — the PM/PD inline set/edit control for a WP's labor budget (a
// money cost ceiling, baht). Rendered only inside the PM review ค่าแรง section
// (requireRole PM_ROLES), so it never reaches a site_admin field session. Writes
// through setWpLaborBudget (→ set_wp_labor_budget definer, gated PM/PD/super).
// Mirrors the equipment SetDailyRate control.
//
// 'use client' justification: a sheet toggle + numeric input with busy/error state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Banknote } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { FIELD_INPUT, BUTTON_PRIMARY_COMPACT, INLINE_ERROR } from "@/lib/ui/classes";
import { setWpLaborBudget } from "@/lib/labor/actions";
import {
  LABOR_BUDGET_LABEL,
  SET_LABOR_BUDGET_LABEL,
  EDIT_LABOR_BUDGET_LABEL,
} from "@/lib/i18n/labels";

interface LaborBudgetControlProps {
  workPackageId: string;
  revalidate: string;
  /** the current budget (baht), or null when unset. */
  currentBudget: number | null;
}

export function LaborBudgetControl({
  workPackageId,
  revalidate,
  currentBudget,
}: LaborBudgetControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentBudget === null ? "" : String(currentBudget));
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function close() {
    setError(null);
    setValue(currentBudget === null ? "" : String(currentBudget));
    setOpen(false);
  }

  function handleSave() {
    const budget = Number(value);
    if (value.trim() === "" || !Number.isFinite(budget) || budget < 0) {
      setError("กรอกงบค่าแรงเป็นตัวเลข (ไม่ติดลบ)");
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await setWpLaborBudget({ workPackageId, budget, revalidate });
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
        {currentBudget === null ? SET_LABOR_BUDGET_LABEL : EDIT_LABOR_BUDGET_LABEL}
      </button>

      <BottomSheet open={open} title={SET_LABOR_BUDGET_LABEL} onClose={close}>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-meta text-ink-secondary font-medium">
              {LABOR_BUDGET_LABEL} (บาท)
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
