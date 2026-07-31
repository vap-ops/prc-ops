"use client";

// Feedback 41cd07d9 — per-row แก้ไข/ลบ on the submitter's own expense list.
// Renders NOTHING for a reimbursed row: the RPC locks those (P0001), and the
// affordance must never offer what the server refuses. The sheet mirrors the
// record form's fields (category/description/amount/date/source/card/project),
// prefilled from the row; the reimburse target is re-derived server-side.
// Delete is a two-step inline confirm — the warning states the audit snapshot
// survives but the row does not.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteOfficeExpense, updateOfficeExpense } from "@/app/expenses/actions";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import type { OfficeExpenseRow } from "@/lib/expenses/load-office-expenses";
import type { PaymentSource } from "@/lib/expenses/validate-office-expense";
import { validateOfficeExpense } from "@/lib/expenses/validate-office-expense";
import {
  EXPENSE_AMOUNT_LABEL,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_DATE_LABEL,
  EXPENSE_DELETE_CONFIRM,
  EXPENSE_DELETE_LABEL,
  EXPENSE_DELETE_PENDING,
  EXPENSE_DESCRIPTION_LABEL,
  EXPENSE_EDIT_HEADING,
  EXPENSE_EDIT_LABEL,
  EXPENSE_PAYMENT_SOURCE_LABEL,
  EXPENSE_PROJECT_LABEL,
  EXPENSE_PROJECT_NONE,
  EXPENSE_UPDATE_SUBMIT,
  PAYMENT_SOURCE_CARD_LABEL,
  PAYMENT_SOURCE_DIRECT_LABEL,
  PAYMENT_SOURCE_OWN_LABEL,
} from "@/lib/i18n/labels";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  FIELD_INPUT,
  INLINE_ERROR,
} from "@/lib/ui/classes";

const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const LABEL = "text-ink flex flex-col gap-1 text-sm font-medium";
const CHIP_BUTTON =
  "rounded-control border-edge text-ink-secondary border px-2 py-0.5 text-xs font-medium";

export interface ExpenseEditOption {
  id: string;
  label: string;
}
export interface ExpenseEditProject {
  id: string;
  name: string;
}
export interface ExpenseEditCard {
  id: string;
  label: string;
  holderName: string | null;
}

export function ExpenseRowActions({
  row,
  categories,
  projects,
  cards,
}: {
  row: OfficeExpenseRow;
  categories: ExpenseEditOption[];
  projects: ExpenseEditProject[];
  cards: ExpenseEditCard[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const [categoryId, setCategoryId] = useState(row.categoryId ?? "");
  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState(String(row.amount));
  const [expenseDate, setExpenseDate] = useState(row.expenseDate);
  const [paymentSource, setPaymentSource] = useState<PaymentSource>(
    row.paymentSource as PaymentSource,
  );
  const [companyCardId, setCompanyCardId] = useState(row.companyCardId ?? "");
  const [projectId, setProjectId] = useState(row.projectId ?? "");

  // A reimbursed row is server-locked — no affordance at all.
  if (row.reimbursedAt) return null;

  const close = () => {
    setOpen(false);
    setConfirmingDelete(false);
    setError(null);
  };

  const submit = () => {
    const validated = validateOfficeExpense({
      categoryId,
      description,
      amount: Number(amount),
      expenseDate,
      paymentSource,
      companyCardId: paymentSource === "company_card" ? companyCardId || null : null,
      projectId: projectId || null,
    });
    if (!validated.ok) {
      setError(validated.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateOfficeExpense({ expenseId: row.id, ...validated.value });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.refresh();
    });
  };

  const doDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteOfficeExpense(row.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      router.refresh();
    });
  };

  return (
    <>
      <button type="button" className={CHIP_BUTTON} onClick={() => setOpen(true)}>
        {EXPENSE_EDIT_LABEL}
      </button>
      <BottomSheet open={open} title={EXPENSE_EDIT_HEADING} onClose={close}>
        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <label className={LABEL}>
            {EXPENSE_CATEGORY_LABEL}
            <select
              className={SELECT}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={busy}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <label className={LABEL}>
            {EXPENSE_DESCRIPTION_LABEL}
            <input
              className={FIELD_INPUT}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className={LABEL}>
            {EXPENSE_AMOUNT_LABEL}
            <input
              className={FIELD_INPUT}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className={LABEL}>
            {EXPENSE_DATE_LABEL}
            <input
              className={FIELD_INPUT}
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className={LABEL}>
            {EXPENSE_PAYMENT_SOURCE_LABEL}
            <select
              className={SELECT}
              value={paymentSource}
              onChange={(e) => {
                const next = e.target.value as PaymentSource;
                setPaymentSource(next);
                if (next !== "company_card") setCompanyCardId("");
              }}
              disabled={busy}
            >
              <option value="own_money">{PAYMENT_SOURCE_OWN_LABEL}</option>
              {(cards.length > 0 || row.paymentSource === "company_card") && (
                <option value="company_card">{PAYMENT_SOURCE_CARD_LABEL}</option>
              )}
              <option value="company_direct">{PAYMENT_SOURCE_DIRECT_LABEL}</option>
            </select>
          </label>

          {paymentSource === "company_card" && (
            <label className={LABEL}>
              {PAYMENT_SOURCE_CARD_LABEL}
              <select
                className={SELECT}
                value={companyCardId}
                onChange={(e) => setCompanyCardId(e.target.value)}
                disabled={busy}
              >
                <option value="">—</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.holderName ? ` · ${c.holderName}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className={LABEL}>
            {EXPENSE_PROJECT_LABEL}
            <select
              className={SELECT}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={busy}
            >
              <option value="">{EXPENSE_PROJECT_NONE}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {error && <p className={INLINE_ERROR}>{error}</p>}

          {confirmingDelete ? (
            <div className="border-attn-edge bg-attn-soft flex flex-col gap-2 rounded-xl border p-3">
              <p className="text-attn-ink text-sm">{EXPENSE_DELETE_CONFIRM}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${BUTTON_SECONDARY_MUTED} flex-1`}
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className={`${BUTTON_PRIMARY} flex-1`}
                  onClick={doDelete}
                  disabled={busy}
                >
                  {busy ? EXPENSE_DELETE_PENDING : EXPENSE_DELETE_LABEL}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${BUTTON_SECONDARY_MUTED} flex-1`}
                  onClick={close}
                  disabled={busy}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  className={`${BUTTON_PRIMARY} flex-1`}
                  onClick={submit}
                  disabled={busy}
                >
                  {EXPENSE_UPDATE_SUBMIT}
                </button>
              </div>
              <button
                type="button"
                className="text-attn-ink self-start text-xs font-medium underline-offset-2 hover:underline"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
              >
                {EXPENSE_DELETE_LABEL}
              </button>
            </div>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
