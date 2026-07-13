"use client";

// Spec 310 U10 — the add-expense entry point. A floating pill (bottom-right,
// above the tab bar — same corner as the SA camera FAB) opens the record form in
// a bottom sheet, so the /expenses page reads as a dashboard (summary + list +
// finance queue) instead of a dashboard-with-a-form-stapled-on (operator
// 2026-07-13). The sheet closes itself on a clean save via the form's onDone.

import { useState } from "react";
import { Plus } from "lucide-react";

import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { OfficeExpenseForm } from "@/components/features/expenses/office-expense-form";
import type {
  CompanyCard,
  ExpenseCategory,
  ProjectOption,
} from "@/lib/expenses/load-office-expenses";
import { EXPENSE_ADD_HEADING, EXPENSE_ADD_LABEL } from "@/lib/i18n/labels";

const FAB_CLASS =
  "fixed bottom-24 right-5 z-30 flex items-center gap-2 rounded-2xl bg-fill px-4 py-3.5 text-sm font-semibold text-on-fill shadow-card transition-colors hover:bg-fill-press focus:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 active:translate-y-px";

export function AddExpenseFab({
  categories,
  projects,
  myCard,
}: {
  categories: ExpenseCategory[];
  projects: ProjectOption[];
  myCard: CompanyCard | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={EXPENSE_ADD_LABEL}
        onClick={() => setOpen(true)}
        className={FAB_CLASS}
      >
        <Plus aria-hidden className="size-5 shrink-0" />
        <span>{EXPENSE_ADD_LABEL}</span>
      </button>

      <BottomSheet open={open} title={EXPENSE_ADD_HEADING} onClose={() => setOpen(false)}>
        <OfficeExpenseForm
          categories={categories}
          projects={projects}
          myCard={myCard}
          onDone={() => setOpen(false)}
        />
      </BottomSheet>
    </>
  );
}
