"use client";

// Spec 323 U1c — the record-a-rental entry point. A floating pill (bottom-right,
// above the tab bar — same corner as the /expenses AddExpenseFab) opens the deal
// form in a bottom sheet, so the rental pages read as a read-only list instead of a
// list-with-a-form-stapled-on (operator 2026-07-15). The sheet closes itself on a
// clean save via the form's onDone. Mirrors add-expense-fab.tsx.

import { useState } from "react";
import { Plus } from "lucide-react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { RentalDealForm } from "@/components/features/equipment/rental-deal-form";
import { EQUIPMENT_RENTAL_RECORD_LABEL } from "@/lib/i18n/labels";

const FAB_CLASS =
  "fixed bottom-24 right-5 z-30 flex items-center gap-2 rounded-2xl bg-fill px-4 py-3.5 text-sm font-semibold text-on-fill shadow-card transition-colors hover:bg-fill-press focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px";

interface NamedRow {
  id: string;
  name: string;
}

export function AddRentalFab({
  suppliers,
  projects,
  defaultDate,
  lockedProject,
  suggestedSupplierIds = [],
}: {
  suppliers: NamedRow[];
  projects: NamedRow[];
  defaultDate: string;
  lockedProject?: { id: string; name: string };
  suggestedSupplierIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={EQUIPMENT_RENTAL_RECORD_LABEL}
        onClick={() => setOpen(true)}
        className={FAB_CLASS}
      >
        <Plus aria-hidden className="size-5 shrink-0" />
        <span>{EQUIPMENT_RENTAL_RECORD_LABEL}</span>
      </button>

      <BottomSheet open={open} title={EQUIPMENT_RENTAL_RECORD_LABEL} onClose={() => setOpen(false)}>
        <RentalDealForm
          suppliers={suppliers}
          projects={projects}
          defaultDate={defaultDate}
          suggestedSupplierIds={suggestedSupplierIds}
          {...(lockedProject ? { lockedProject } : {})}
          onDone={() => setOpen(false)}
        />
      </BottomSheet>
    </>
  );
}
