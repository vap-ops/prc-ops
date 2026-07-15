"use client";

// Spec 323 U1c — the record-a-settlement form, extracted from RentalSettlementManager
// so it can be hosted in a bottom sheet (operator 2026-07-15: forms off the list). A
// settlement is a back-office vendor invoice against a rental agreement: base +
// overtime + fees = net (shown live; the deposit is resolved separately, never
// netted) · VAT · deposit refunded/forfeited · payment method · note. On a clean save
// it calls recordRentalSettlement, refreshes, then onDone() to close the sheet. The
// shared money inputs (AmountInputs/MoneyField/parseAmounts) live here and are reused
// by the correction sheet in RentalSettlementManager. Writes go through the SECURITY
// DEFINER RPCs via the server actions.
//
// 'use client' justification: a multi-field money form with a live net + busy/error.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RadioChip } from "@/components/features/common/radio-chip";
import { bahtWithSymbol } from "@/lib/format";
import {
  RECEIPT_METHOD_LABEL,
  RENTAL_SETTLEMENT_AGREEMENT_LABEL,
  RENTAL_SETTLEMENT_BASE_LABEL,
  RENTAL_SETTLEMENT_DEPOSIT_FORFEITED_LABEL,
  RENTAL_SETTLEMENT_DEPOSIT_REFUNDED_LABEL,
  RENTAL_SETTLEMENT_FEES_LABEL,
  RENTAL_SETTLEMENT_INVOICE_DATE_LABEL,
  RENTAL_SETTLEMENT_INVOICE_NO_LABEL,
  RENTAL_SETTLEMENT_METHOD_LABEL,
  RENTAL_SETTLEMENT_NET_LABEL,
  RENTAL_SETTLEMENT_OVERTIME_LABEL,
  RENTAL_SETTLEMENT_RECORD_LABEL,
  RENTAL_SETTLEMENT_VAT_LABEL,
} from "@/lib/i18n/labels";
import {
  BUTTON_PRIMARY_COMPACT,
  FIELD_SELECT,
  FIELD_STACKED,
  INLINE_ERROR,
} from "@/lib/ui/classes";
import { recordRentalSettlement } from "@/app/equipment/rentals/actions";
import {
  settlementNet,
  type AgreementOption,
  type ReceiptMethod,
} from "@/lib/equipment/rental-settlement-view";

const METHODS: readonly ReceiptMethod[] = ["bank_transfer", "cheque", "cash"];

// Parse a money input: empty = 0, else a finite non-negative number (null = bad).
export function parseAmount(raw: string): number | null {
  if (raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// The base + overtime + fees + vat + deposit amounts shared by record and correct.
export interface AmountFields {
  base: string;
  overtime: string;
  fees: string;
  vat: string;
  depositRefunded: string;
  depositForfeited: string;
}

export interface ParsedAmounts {
  base: number;
  overtime: number;
  fees: number;
  vat: number;
  depositRefunded: number;
  depositForfeited: number;
}

export function parseAmounts(f: AmountFields): ParsedAmounts | null {
  const base = parseAmount(f.base);
  const overtime = parseAmount(f.overtime);
  const fees = parseAmount(f.fees);
  const vat = parseAmount(f.vat);
  const depositRefunded = parseAmount(f.depositRefunded);
  const depositForfeited = parseAmount(f.depositForfeited);
  if (
    base === null ||
    overtime === null ||
    fees === null ||
    vat === null ||
    depositRefunded === null ||
    depositForfeited === null
  ) {
    return null;
  }
  return { base, overtime, fees, vat, depositRefunded, depositForfeited };
}

export const AMOUNTS_ERROR = "กรอกจำนวนเงินเป็นตัวเลข (ไม่ติดลบ)";

export const EMPTY_AMOUNTS: AmountFields = {
  base: "",
  overtime: "",
  fees: "",
  vat: "",
  depositRefunded: "",
  depositForfeited: "",
};

// The money inputs + method radios + a live net, shared by the record and correct
// forms (rendered as fragment children so each form owns its own <form> region).
export function AmountInputs({
  amounts,
  onAmounts,
  method,
  onMethod,
  radioName,
}: {
  amounts: AmountFields;
  onAmounts: (patch: Partial<AmountFields>) => void;
  method: ReceiptMethod;
  onMethod: (m: ReceiptMethod) => void;
  // Native radios group by `name` across the whole document, so each form instance
  // (the record form + every open correction row) needs its own name — otherwise
  // selecting a method in one uncrosses the selection in another.
  radioName: string;
}) {
  const net = settlementNet(
    parseAmount(amounts.base) ?? 0,
    parseAmount(amounts.overtime) ?? 0,
    parseAmount(amounts.fees) ?? 0,
  );
  return (
    <>
      <MoneyField
        label={RENTAL_SETTLEMENT_BASE_LABEL}
        value={amounts.base}
        onChange={(v) => onAmounts({ base: v })}
      />
      <MoneyField
        label={RENTAL_SETTLEMENT_OVERTIME_LABEL}
        value={amounts.overtime}
        onChange={(v) => onAmounts({ overtime: v })}
      />
      <MoneyField
        label={RENTAL_SETTLEMENT_FEES_LABEL}
        value={amounts.fees}
        onChange={(v) => onAmounts({ fees: v })}
      />
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-ink-secondary text-sm">{RENTAL_SETTLEMENT_NET_LABEL}</span>
        <span className="text-ink font-semibold">{bahtWithSymbol(net)}</span>
      </div>
      <MoneyField
        label={RENTAL_SETTLEMENT_VAT_LABEL}
        value={amounts.vat}
        onChange={(v) => onAmounts({ vat: v })}
      />
      <MoneyField
        label={RENTAL_SETTLEMENT_DEPOSIT_REFUNDED_LABEL}
        value={amounts.depositRefunded}
        onChange={(v) => onAmounts({ depositRefunded: v })}
      />
      <MoneyField
        label={RENTAL_SETTLEMENT_DEPOSIT_FORFEITED_LABEL}
        value={amounts.depositForfeited}
        onChange={(v) => onAmounts({ depositForfeited: v })}
      />
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={RENTAL_SETTLEMENT_METHOD_LABEL}
      >
        {METHODS.map((m) => (
          <RadioChip
            key={m}
            name={radioName}
            label={RECEIPT_METHOD_LABEL[m]}
            checked={method === m}
            onSelect={() => onMethod(m)}
          />
        ))}
      </div>
    </>
  );
}

function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="text-ink-secondary mt-2 block text-sm">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_STACKED}
      />
    </label>
  );
}

export function RentalSettlementForm({
  agreements,
  defaultDate,
  onDone,
}: {
  agreements: AgreementOption[];
  defaultDate: string;
  // Spec 323 U1c: called after a clean save so the hosting sheet can close.
  onDone?: () => void;
}) {
  const router = useRouter();
  const [agreementId, setAgreementId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(defaultDate);
  const [amounts, setAmounts] = useState<AmountFields>(EMPTY_AMOUNTS);
  const [method, setMethod] = useState<ReceiptMethod>("bank_transfer");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function patchAmounts(patch: Partial<AmountFields>) {
    setAmounts((prev) => ({ ...prev, ...patch }));
  }

  function handleRecord() {
    if (agreementId === "") {
      setError("กรุณาเลือกสัญญาเช่า");
      return;
    }
    if (invoiceNo.trim() === "") {
      setError("กรุณาระบุเลขที่ใบแจ้งหนี้");
      return;
    }
    if (invoiceDate.trim() === "") {
      setError("กรุณาระบุวันที่ใบแจ้งหนี้");
      return;
    }
    const parsed = parseAmounts(amounts);
    if (parsed === null) {
      setError(AMOUNTS_ERROR);
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await recordRentalSettlement({
        agreementId,
        invoiceNo,
        invoiceDate,
        ...parsed,
        method,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDone?.();
    });
  }

  return (
    <div aria-label={RENTAL_SETTLEMENT_RECORD_LABEL}>
      <label className="text-ink-secondary block text-sm">
        {RENTAL_SETTLEMENT_AGREEMENT_LABEL}
        <select
          value={agreementId}
          onChange={(e) => setAgreementId(e.target.value)}
          className={`${FIELD_SELECT} mt-1`}
        >
          <option value="">— เลือกสัญญาเช่า —</option>
          {agreements.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-ink-secondary mt-2 block text-sm">
        {RENTAL_SETTLEMENT_INVOICE_NO_LABEL}
        <input
          type="text"
          value={invoiceNo}
          onChange={(e) => setInvoiceNo(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>

      <label className="text-ink-secondary mt-2 block text-sm">
        {RENTAL_SETTLEMENT_INVOICE_DATE_LABEL}
        <input
          type="date"
          value={invoiceDate}
          onChange={(e) => setInvoiceDate(e.target.value)}
          className={FIELD_STACKED}
        />
      </label>

      <AmountInputs
        amounts={amounts}
        onAmounts={patchAmounts}
        method={method}
        onMethod={setMethod}
        radioName="settlement-method-record"
      />

      <label className="text-ink-secondary mt-2 block text-sm">
        หมายเหตุ
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={FIELD_STACKED}
        />
      </label>

      {error && (
        <span role="alert" className={`${INLINE_ERROR} mt-2 block`}>
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={handleRecord}
        disabled={saving}
        className={`${BUTTON_PRIMARY_COMPACT} mt-3`}
      >
        {saving ? "กำลังบันทึก…" : RENTAL_SETTLEMENT_RECORD_LABEL}
      </button>
    </div>
  );
}
