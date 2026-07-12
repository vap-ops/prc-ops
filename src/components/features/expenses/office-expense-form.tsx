"use client";

// Spec 310 U3 — record a non-WP office expense. Category + amount + date +
// optional project + payment source. The payment source drives who gets
// reimbursed (shown live); the RPC re-resolves the target server-side.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { recordOfficeExpense } from "@/app/expenses/actions";
import { ExpenseReceiptUploader } from "@/components/features/expenses/expense-receipt-uploader";
import { bangkokTodayIso } from "@/lib/dates";
import type { PaymentSource } from "@/lib/expenses/validate-office-expense";
import { validateOfficeExpense } from "@/lib/expenses/validate-office-expense";
import type {
  CompanyCard,
  ExpenseCategory,
  ProjectOption,
} from "@/lib/expenses/load-office-expenses";
import {
  EXPENSE_AMOUNT_LABEL,
  EXPENSE_CARD_PICK_LABEL,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_PLACEHOLDER,
  EXPENSE_DATE_LABEL,
  EXPENSE_DESCRIPTION_LABEL,
  EXPENSE_PAYMENT_SOURCE_LABEL,
  EXPENSE_PROJECT_LABEL,
  EXPENSE_PROJECT_NONE,
  EXPENSE_RECORD_ANOTHER,
  EXPENSE_RECORDED_ATTACH,
  EXPENSE_REIMBURSE_NONE,
  EXPENSE_REIMBURSE_SELF,
  EXPENSE_REIMBURSE_TO_PREFIX,
  EXPENSE_SUBMIT_LABEL,
  PAYMENT_SOURCE_CARD_LABEL,
  PAYMENT_SOURCE_DIRECT_LABEL,
  PAYMENT_SOURCE_OWN_LABEL,
} from "@/lib/i18n/labels";
import { BUTTON_PRIMARY, FIELD_INPUT, INLINE_ERROR } from "@/lib/ui/classes";

const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const LABEL = "text-ink flex flex-col gap-1 text-sm font-medium";

const SOURCES: { value: PaymentSource; label: string }[] = [
  { value: "company_card", label: PAYMENT_SOURCE_CARD_LABEL },
  { value: "own_money", label: PAYMENT_SOURCE_OWN_LABEL },
  { value: "company_direct", label: PAYMENT_SOURCE_DIRECT_LABEL },
];

function chipClass(active: boolean): string {
  return active
    ? "border-action bg-action-soft text-action rounded-control border px-3 py-2 text-sm font-medium"
    : "border-edge bg-card text-ink-soft rounded-control border px-3 py-2 text-sm font-medium";
}

export function OfficeExpenseForm({
  categories,
  projects,
  cards,
}: {
  categories: ExpenseCategory[];
  projects: ProjectOption[];
  cards: CompanyCard[];
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  // Default to today in Asia/Bangkok (app dates are Bangkok, never UTC — spec 46 C7;
  // fixed TZ ⇒ same value on server + client, no hydration mismatch).
  const [expenseDate, setExpenseDate] = useState(bangkokTodayIso);
  const [projectId, setProjectId] = useState("");
  const [paymentSource, setPaymentSource] = useState<PaymentSource>("own_money");
  const [companyCardId, setCompanyCardId] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectedCard = cards.find((c) => c.id === companyCardId) ?? null;

  const reimburseHint =
    paymentSource === "own_money"
      ? EXPENSE_REIMBURSE_SELF
      : paymentSource === "company_direct"
        ? EXPENSE_REIMBURSE_NONE
        : selectedCard
          ? `${EXPENSE_REIMBURSE_TO_PREFIX}: ${selectedCard.holderName ?? "—"}`
          : null;

  function submit() {
    setError(null);
    const parsed = validateOfficeExpense({
      categoryId,
      description,
      amount: amount.trim() === "" ? NaN : Number(amount),
      expenseDate,
      paymentSource,
      projectId: projectId === "" ? null : projectId,
      companyCardId:
        paymentSource === "company_card" && companyCardId !== "" ? companyCardId : null,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    startTransition(async () => {
      const result = await recordOfficeExpense(parsed.value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // reveal the receipt uploader for the just-recorded expense, then reset
      // the fields for the next entry; the list below refreshes with the new row
      setRecordedId(result.id);
      setCategoryId("");
      setAmount("");
      setProjectId("");
      setCompanyCardId("");
      setDescription("");
      setPaymentSource("own_money");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {recordedId && (
        <div className="border-done-edge bg-done-soft text-done-ink flex flex-col items-start gap-2 rounded-xl border p-4">
          <span className="text-sm font-medium">{EXPENSE_RECORDED_ATTACH}</span>
          <ExpenseReceiptUploader
            officeExpenseId={recordedId}
            onUploaded={() => router.refresh()}
          />
          <button
            type="button"
            onClick={() => setRecordedId(null)}
            className="text-ink-soft text-xs font-medium underline"
          >
            {EXPENSE_RECORD_ANOTHER}
          </button>
        </div>
      )}
      <div className="border-edge bg-card flex flex-col gap-3 rounded-xl border p-4">
        <label className={LABEL}>
          {EXPENSE_CATEGORY_LABEL}
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={pending}
            className={SELECT}
          >
            <option value="" disabled>
              {EXPENSE_CATEGORY_PLACEHOLDER}
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.labelTh}
              </option>
            ))}
          </select>
        </label>

        <label className={LABEL}>
          {EXPENSE_AMOUNT_LABEL}
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
            className={FIELD_INPUT}
          />
        </label>

        <label className={LABEL}>
          {EXPENSE_DATE_LABEL}
          <input
            type="date"
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            disabled={pending}
            className={FIELD_INPUT}
          />
        </label>

        <label className={LABEL}>
          {EXPENSE_PROJECT_LABEL}
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={pending}
            className={SELECT}
          >
            <option value="">{EXPENSE_PROJECT_NONE}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-ink text-sm font-medium">{EXPENSE_PAYMENT_SOURCE_LABEL}</span>
          <div className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => {
                  setPaymentSource(s.value);
                  if (s.value !== "company_card") setCompanyCardId("");
                }}
                disabled={pending}
                aria-pressed={paymentSource === s.value}
                className={chipClass(paymentSource === s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {paymentSource === "company_card" && (
          <label className={LABEL}>
            {EXPENSE_CARD_PICK_LABEL}
            <select
              value={companyCardId}
              onChange={(e) => setCompanyCardId(e.target.value)}
              disabled={pending}
              className={SELECT}
            >
              <option value="" disabled>
                {EXPENSE_CARD_PICK_LABEL}
              </option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.last4 ? ` ·${c.last4}` : ""} · {c.holderName ?? "—"}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={LABEL}>
          {EXPENSE_DESCRIPTION_LABEL}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
            rows={2}
            className={FIELD_INPUT}
          />
        </label>

        {reimburseHint && <p className="text-ink-soft text-sm">→ {reimburseHint}</p>}
        {error && (
          <p role="alert" className={INLINE_ERROR}>
            {error}
          </p>
        )}

        <button type="button" onClick={submit} disabled={pending} className={BUTTON_PRIMARY}>
          {EXPENSE_SUBMIT_LABEL}
        </button>
      </div>
    </div>
  );
}
