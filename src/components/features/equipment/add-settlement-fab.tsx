"use client";

// Spec 323 U1c — the record-a-settlement entry point on /equipment/rentals. A second
// floating pill stacked ABOVE the record-deal FAB (bottom-40 vs bottom-24), so both
// record actions share the /expenses one-uniform-pattern (operator 2026-07-15). Opens
// the settlement form in a bottom sheet; the sheet closes itself on a clean save via
// the form's onDone. Only rendered on the cross-project settings overview (the project
// page has no settlement surface).

import { useState } from "react";
import { Plus } from "lucide-react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { RentalSettlementForm } from "@/components/features/equipment/rental-settlement-form";
import type { AgreementOption } from "@/lib/equipment/rental-settlement-view";
import { RENTAL_SETTLEMENT_RECORD_LABEL } from "@/lib/i18n/labels";

const FAB_CLASS =
  "fixed bottom-40 right-5 z-30 flex items-center gap-2 rounded-2xl bg-card border border-edge-strong px-4 py-3.5 text-sm font-semibold text-ink shadow-card transition-colors hover:bg-sunk focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px";

export function AddSettlementFab({
  agreements,
  defaultDate,
}: {
  agreements: AgreementOption[];
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={RENTAL_SETTLEMENT_RECORD_LABEL}
        onClick={() => setOpen(true)}
        className={FAB_CLASS}
      >
        <Plus aria-hidden className="size-5 shrink-0" />
        <span>{RENTAL_SETTLEMENT_RECORD_LABEL}</span>
      </button>

      <BottomSheet
        open={open}
        title={RENTAL_SETTLEMENT_RECORD_LABEL}
        onClose={() => setOpen(false)}
      >
        <RentalSettlementForm
          agreements={agreements}
          defaultDate={defaultDate}
          onDone={() => setOpen(false)}
        />
      </BottomSheet>
    </>
  );
}
