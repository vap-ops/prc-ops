"use client";

// Spec 310 U3/U10 — record a non-WP office expense. Attachments sit at the TOP
// (held in state, uploaded on submit after the expense row exists) so that a
// future step can let an LLM read them and prefill the fields below (operator
// 2026-07-13). Category + amount + date + optional project + payment source; the
// payment source drives who gets reimbursed (shown live) and the RPC re-resolves
// the target server-side. รายละเอียด is optional. Lives in a bottom sheet — on a
// clean save the form calls onDone() to close it; a partial attachment failure
// keeps it open with a retry slot for the doc that didn't land.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Building2, CreditCard, Paperclip, X, type LucideIcon } from "lucide-react";

import { recordOfficeExpense } from "@/app/expenses/actions";
import type { ExpenseDocPurpose } from "@/app/expenses/actions";
import { ExpenseReceiptUploader } from "@/components/features/expenses/expense-receipt-uploader";
import { bangkokTodayIso } from "@/lib/dates";
import type { PaymentSource } from "@/lib/expenses/validate-office-expense";
import { validateOfficeExpense } from "@/lib/expenses/validate-office-expense";
import { uploadExpenseReceiptFile } from "@/lib/expenses/upload-expense-receipt";
import type {
  CompanyCard,
  ExpenseCategory,
  ProjectOption,
} from "@/lib/expenses/load-office-expenses";
import {
  EXPENSE_AMOUNT_LABEL,
  EXPENSE_ATTACH_HEADING,
  EXPENSE_CARD_USING_PREFIX,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_PLACEHOLDER,
  EXPENSE_DATE_LABEL,
  EXPENSE_DESCRIPTION_HELP,
  EXPENSE_DESCRIPTION_LABEL,
  EXPENSE_PAYMENT_SOURCE_LABEL,
  EXPENSE_PROJECT_LABEL,
  EXPENSE_PROJECT_NONE,
  EXPENSE_INVOICE_UPLOAD_LABEL,
  EXPENSE_RECORDED_ATTACH,
  EXPENSE_SLIP_UPLOAD_LABEL,
  EXPENSE_REIMBURSE_NONE,
  EXPENSE_REIMBURSE_SELF,
  EXPENSE_REIMBURSE_TO_PREFIX,
  EXPENSE_SUBMIT_LABEL,
  PAYMENT_SOURCE_CARD_LABEL,
  PAYMENT_SOURCE_DIRECT_LABEL,
  PAYMENT_SOURCE_OWN_LABEL,
} from "@/lib/i18n/labels";
import { ATTACHMENT_ACCEPT_MIME } from "@/lib/purchasing/attachment-file";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY_MUTED,
  FIELD_INPUT,
  INLINE_ERROR,
} from "@/lib/ui/classes";

const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";
const LABEL = "text-ink flex flex-col gap-1 text-sm font-medium";

// Card is the CENTER option (operator 2026-07-13); when the user holds no card
// it's filtered out and own/direct remain.
const SOURCES: { value: PaymentSource; label: string; Icon: LucideIcon }[] = [
  { value: "own_money", label: PAYMENT_SOURCE_OWN_LABEL, Icon: Banknote },
  { value: "company_card", label: PAYMENT_SOURCE_CARD_LABEL, Icon: CreditCard },
  { value: "company_direct", label: PAYMENT_SOURCE_DIRECT_LABEL, Icon: Building2 },
];

function chipClass(active: boolean): string {
  // Equal-width tiles (flex-1) with the icon above a short label — one row at any
  // width (never wraps), symbol carries the type (spec 310 U11).
  const base =
    "flex flex-1 flex-col items-center gap-1 rounded-control border px-1.5 py-2 text-center text-xs leading-tight font-medium";
  return active
    ? `border-action bg-action-soft text-action ${base}`
    : `border-edge bg-card text-ink-secondary ${base}`;
}

// A held file slot — pick a file into local state (uploaded on submit), or clear
// it. No upload happens here; the bytes ride along to the submit handler.
function HeldFilePicker({
  label,
  file,
  onPick,
  disabled,
}: {
  label: string;
  file: File | null;
  onPick: (file: File | null) => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-1">
      <input
        ref={ref}
        type="file"
        accept={ATTACHMENT_ACCEPT_MIME}
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        disabled={disabled}
      />
      {file ? (
        <div className="border-edge bg-card rounded-control flex items-center justify-between gap-2 border px-3 py-2 text-sm">
          <span className="text-ink truncate">{file.name}</span>
          <button
            type="button"
            onClick={() => {
              onPick(null);
              // Clear the input so re-selecting the SAME file still fires change.
              if (ref.current) ref.current.value = "";
            }}
            disabled={disabled}
            aria-label="เอาไฟล์ออก"
            className="text-ink-muted hover:text-ink -mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={disabled}
          className={BUTTON_SECONDARY_MUTED}
        >
          <Paperclip aria-hidden className="mr-1.5 inline size-4" />
          {label}
        </button>
      )}
    </div>
  );
}

export function OfficeExpenseForm({
  categories,
  projects,
  myCard,
  onDone,
}: {
  categories: ExpenseCategory[];
  projects: ProjectOption[];
  // Spec 310 U8 — a user holds at most one card. null = they hold none, so the
  // company-card source is hidden; otherwise it's auto-used (no picker).
  myCard: CompanyCard | null;
  // Spec 310 U10 — the sheet host passes this to close on a clean save.
  onDone?: () => void;
}) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  // Default to today in Asia/Bangkok (app dates are Bangkok, never UTC — spec 46 C7;
  // fixed TZ ⇒ same value on server + client, no hydration mismatch).
  const [expenseDate, setExpenseDate] = useState(bangkokTodayIso);
  const [projectId, setProjectId] = useState("");
  // Default to the company card when the user holds one (operator 2026-07-13),
  // else own-money. Re-inits per sheet open (the form unmounts on close).
  const [paymentSource, setPaymentSource] = useState<PaymentSource>(
    myCard ? "company_card" : "own_money",
  );
  const [description, setDescription] = useState("");
  // Attachments held until submit (uploaded once the expense row exists).
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set only when the expense saved but an attachment upload failed — the row
  // exists, so we surface a retry slot for the doc(s) that didn't land.
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [failedPurposes, setFailedPurposes] = useState<ExpenseDocPurpose[]>([]);
  const [pending, startTransition] = useTransition();

  // Only offer the company-card source if the user actually holds a card.
  const sources = myCard ? SOURCES : SOURCES.filter((s) => s.value !== "company_card");

  const reimburseHint =
    paymentSource === "own_money"
      ? EXPENSE_REIMBURSE_SELF
      : paymentSource === "company_direct"
        ? EXPENSE_REIMBURSE_NONE
        : myCard
          ? `${EXPENSE_REIMBURSE_TO_PREFIX}: ${myCard.holderName ?? "—"}`
          : null;

  function resetFields() {
    setCategoryId("");
    setAmount("");
    setProjectId("");
    setDescription("");
    setPaymentSource(myCard ? "company_card" : "own_money");
    setSlipFile(null);
    setInvoiceFile(null);
  }

  function submit() {
    setError(null);
    // รายละเอียด is optional; when blank, fall back to the category label so the
    // row is self-describing (DB requires 1–500 chars).
    const categoryLabel = categories.find((c) => c.id === categoryId)?.labelTh ?? "";
    const effectiveDescription = description.trim() === "" ? categoryLabel : description;
    // A selected category with no usable label can't self-describe the row — ask
    // for a description rather than letting the RPC's 1–500 CHECK reject it.
    if (categoryId !== "" && effectiveDescription.trim() === "") {
      setError("กรุณาระบุรายละเอียด");
      return;
    }
    const parsed = validateOfficeExpense({
      categoryId,
      description: effectiveDescription,
      amount: amount.trim() === "" ? NaN : Number(amount),
      expenseDate,
      paymentSource,
      projectId: projectId === "" ? null : projectId,
      companyCardId: paymentSource === "company_card" && myCard ? myCard.id : null,
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
      // The row exists — now push any held attachments. Each is best-effort:
      // a failure doesn't lose the expense, it just leaves a retry slot.
      const failed: ExpenseDocPurpose[] = [];
      if (slipFile) {
        const r = await uploadExpenseReceiptFile(result.id, slipFile, "payment_slip");
        if (!r.ok) failed.push("payment_slip");
      }
      if (invoiceFile) {
        const r = await uploadExpenseReceiptFile(result.id, invoiceFile, "tax_invoice");
        if (!r.ok) failed.push("tax_invoice");
      }
      router.refresh();
      if (failed.length === 0) {
        // clean save — reset and let the sheet close
        resetFields();
        onDone?.();
        return;
      }
      // partial failure — keep open, offer a retry slot per failed doc
      setRecordedId(result.id);
      setFailedPurposes(failed);
      setError("บันทึกค่าใช้จ่ายแล้ว แต่แนบเอกสารบางส่วนไม่สำเร็จ กรุณาแนบอีกครั้ง");
    });
  }

  // A retry slot resolved — drop it; when none remain, close. Side effects run
  // AFTER the state set (never inside the updater — that would update the parent
  // sheet mid-render).
  function onRetried(purpose: ExpenseDocPurpose) {
    const next = failedPurposes.filter((p) => p !== purpose);
    setFailedPurposes(next);
    router.refresh();
    if (next.length === 0) {
      setRecordedId(null);
      setError(null);
      resetFields();
      onDone?.();
    }
  }

  if (recordedId) {
    return (
      <div className="border-attn-edge bg-attn-soft text-attn-ink flex flex-col items-start gap-2 rounded-xl border p-4">
        <span className="text-sm font-medium">{error ?? EXPENSE_RECORDED_ATTACH}</span>
        {failedPurposes.includes("payment_slip") && (
          <ExpenseReceiptUploader
            officeExpenseId={recordedId}
            purpose="payment_slip"
            label={EXPENSE_SLIP_UPLOAD_LABEL}
            onUploaded={() => onRetried("payment_slip")}
          />
        )}
        {failedPurposes.includes("tax_invoice") && (
          <ExpenseReceiptUploader
            officeExpenseId={recordedId}
            purpose="tax_invoice"
            label={EXPENSE_INVOICE_UPLOAD_LABEL}
            onUploaded={() => onRetried("tax_invoice")}
          />
        )}
        <button
          type="button"
          onClick={() => {
            setRecordedId(null);
            setError(null);
            resetFields();
            onDone?.();
          }}
          className="text-ink-secondary text-xs font-medium underline"
        >
          เสร็จสิ้น
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Attachments on top — held until submit; sets up future LLM prefill. */}
      <div className="border-edge bg-card flex flex-col gap-2 rounded-xl border p-4">
        <span className="text-ink text-sm font-medium">{EXPENSE_ATTACH_HEADING}</span>
        <HeldFilePicker
          label={EXPENSE_SLIP_UPLOAD_LABEL}
          file={slipFile}
          onPick={setSlipFile}
          disabled={pending}
        />
        <HeldFilePicker
          label={EXPENSE_INVOICE_UPLOAD_LABEL}
          file={invoiceFile}
          onPick={setInvoiceFile}
          disabled={pending}
        />
      </div>

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
          <div className="flex gap-2">
            {sources.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setPaymentSource(s.value)}
                disabled={pending}
                aria-pressed={paymentSource === s.value}
                className={chipClass(paymentSource === s.value)}
              >
                <s.Icon aria-hidden className="size-5 shrink-0" />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {paymentSource === "company_card" && myCard && (
          <p className="text-ink-secondary text-sm">
            {EXPENSE_CARD_USING_PREFIX}: {myCard.label}
            {myCard.last4 ? ` ·${myCard.last4}` : ""}
          </p>
        )}

        <div className="flex flex-col gap-1">
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
          <span className="text-ink-muted text-xs">{EXPENSE_DESCRIPTION_HELP}</span>
        </div>

        {reimburseHint && <p className="text-ink-secondary text-sm">→ {reimburseHint}</p>}
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
