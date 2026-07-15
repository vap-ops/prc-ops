"use client";

// Spec 275 U3 — the rental SETTLEMENT recorder on /equipment/rentals (BACK_OFFICE
// money audience only; the page gate keeps a field session out entirely, so vendor
// invoice figures may render here). One form records a vendor invoice against a
// rental agreement: pick the agreement · invoice no/date · base + overtime + fees
// (net = the sum, shown live — the deposit is resolved separately and never netted)
// · VAT · deposit refunded / forfeited · payment method · note. The history lists
// the live settlements (supersede anti-join done in the page); แก้ไข opens a
// prefilled correction form that supersedes the row (append-only + supersede, never
// UPDATE). Writes go through the two SECURITY DEFINER RPCs via the server actions.
//
// 'use client' justification: a multi-field money form with live net + per-row
// correction disclosure, all with busy/error state.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RadioChip } from "@/components/features/common/radio-chip";
import { bahtWithSymbol } from "@/lib/format";
import {
  formatThaiDate,
  RECEIPT_METHOD_LABEL,
  RENTAL_SETTLEMENT_AGREEMENT_LABEL,
  RENTAL_SETTLEMENT_BASE_LABEL,
  RENTAL_SETTLEMENT_CORRECT_CONFIRM_LABEL,
  RENTAL_SETTLEMENT_CORRECT_LABEL,
  RENTAL_SETTLEMENT_CORRECTION_REASON_LABEL,
  RENTAL_SETTLEMENT_DEPOSIT_FORFEITED_LABEL,
  RENTAL_SETTLEMENT_DEPOSIT_REFUNDED_LABEL,
  RENTAL_SETTLEMENT_EMPTY_LABEL,
  RENTAL_SETTLEMENT_FEES_LABEL,
  RENTAL_SETTLEMENT_HISTORY_LABEL,
  RENTAL_SETTLEMENT_INVOICE_DATE_LABEL,
  RENTAL_SETTLEMENT_INVOICE_NO_LABEL,
  RENTAL_SETTLEMENT_METHOD_LABEL,
  RENTAL_SETTLEMENT_NET_LABEL,
  RENTAL_SETTLEMENT_OVERTIME_LABEL,
  RENTAL_SETTLEMENT_RECORD_LABEL,
  RENTAL_SETTLEMENT_VAT_LABEL,
  RENTAL_SETTLEMENT_ZERO_CANCELS_HINT,
} from "@/lib/i18n/labels";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_SELECT,
  FIELD_STACKED,
  INLINE_ERROR,
  SECTION_HEADING,
} from "@/lib/ui/classes";
import { recordRentalSettlement, supersedeRentalSettlement } from "@/app/equipment/rentals/actions";
import {
  settlementNet,
  type AgreementOption,
  type ReceiptMethod,
  type SettlementListItem,
} from "@/lib/equipment/rental-settlement-view";

const METHODS: readonly ReceiptMethod[] = ["bank_transfer", "cheque", "cash"];

// Parse a money input: empty = 0, else a finite non-negative number (null = bad).
function parseAmount(raw: string): number | null {
  if (raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// The base + overtime + fees + vat + deposit amounts shared by record and correct.
interface AmountFields {
  base: string;
  overtime: string;
  fees: string;
  vat: string;
  depositRefunded: string;
  depositForfeited: string;
}

interface ParsedAmounts {
  base: number;
  overtime: number;
  fees: number;
  vat: number;
  depositRefunded: number;
  depositForfeited: number;
}

function parseAmounts(f: AmountFields): ParsedAmounts | null {
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

const AMOUNTS_ERROR = "กรอกจำนวนเงินเป็นตัวเลข (ไม่ติดลบ)";

// The money inputs + method radios + a live net, shared by the record and correct
// forms (rendered as fragment children so each form owns its own <form> region).
function AmountInputs({
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
  // Native radios group by `name` across the whole document, so each form
  // instance (the record form + every open correction row) needs its own name —
  // otherwise selecting a method in one uncrosses the selection in another.
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

const EMPTY_AMOUNTS: AmountFields = {
  base: "",
  overtime: "",
  fees: "",
  vat: "",
  depositRefunded: "",
  depositForfeited: "",
};

export function RentalSettlementManager({
  agreements,
  settlements,
  defaultDate,
}: {
  agreements: AgreementOption[];
  settlements: SettlementListItem[];
  defaultDate: string;
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

  function resetForm() {
    setAgreementId("");
    setInvoiceNo("");
    setInvoiceDate(defaultDate);
    setAmounts(EMPTY_AMOUNTS);
    setMethod("bank_transfer");
    setNote("");
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
      resetForm();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={RENTAL_SETTLEMENT_RECORD_LABEL}>
        <h2 className={SECTION_HEADING}>{RENTAL_SETTLEMENT_RECORD_LABEL}</h2>
        <div className={CARD}>
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
      </section>

      <section aria-label={RENTAL_SETTLEMENT_HISTORY_LABEL}>
        <h2 className={SECTION_HEADING}>{RENTAL_SETTLEMENT_HISTORY_LABEL}</h2>
        {settlements.length === 0 ? (
          <p className="text-ink-muted text-sm">{RENTAL_SETTLEMENT_EMPTY_LABEL}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {settlements.map((s) => (
              <SettlementRow key={s.id} settlement={s} onChanged={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SettlementRow({
  settlement,
  onChanged,
}: {
  settlement: SettlementListItem;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<AmountFields>(() => ({
    base: String(settlement.base),
    overtime: String(settlement.overtime),
    fees: String(settlement.fees),
    vat: String(settlement.vat),
    depositRefunded: String(settlement.depositRefunded),
    depositForfeited: String(settlement.depositForfeited),
  }));
  const [method, setMethod] = useState<ReceiptMethod>(settlement.method);
  const [correctionReason, setCorrectionReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  function patchAmounts(patch: Partial<AmountFields>) {
    setAmounts((prev) => ({ ...prev, ...patch }));
  }

  function handleSupersede() {
    if (correctionReason.trim() === "") {
      setError("กรุณาระบุเหตุผลการแก้ไข");
      return;
    }
    const parsed = parseAmounts(amounts);
    if (parsed === null) {
      setError(AMOUNTS_ERROR);
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await supersedeRentalSettlement({
        settlementId: settlement.id,
        correctionReason,
        agreementId: settlement.agreementId,
        invoiceNo: settlement.invoiceNo,
        invoiceDate: settlement.invoiceDate,
        ...parsed,
        method,
        note: settlement.note ?? "",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onChanged();
    });
  }

  return (
    <li className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-ink font-semibold break-words">{settlement.invoiceNo}</span>
        <span className="text-ink shrink-0 font-semibold">{bahtWithSymbol(settlement.net)}</span>
      </div>
      <p className="text-ink-secondary mt-1 text-sm break-words">{settlement.agreementLabel}</p>
      <p className="text-ink-muted mt-1 text-sm">
        {`${formatThaiDate(settlement.invoiceDate)} · ${RECEIPT_METHOD_LABEL[settlement.method]}`}
      </p>

      {open ? (
        <div className="border-edge mt-3 border-t pt-3">
          <p className="text-ink-muted mb-2 text-sm">{RENTAL_SETTLEMENT_ZERO_CANCELS_HINT}</p>
          <AmountInputs
            amounts={amounts}
            onAmounts={patchAmounts}
            method={method}
            onMethod={setMethod}
            radioName={`settlement-method-${settlement.id}`}
          />
          <label className="text-ink-secondary mt-2 block text-sm">
            {RENTAL_SETTLEMENT_CORRECTION_REASON_LABEL}
            <input
              type="text"
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              className={FIELD_STACKED}
            />
          </label>
          {error && (
            <span role="alert" className={`${INLINE_ERROR} mt-2 block`}>
              {error}
            </span>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSupersede}
              disabled={saving}
              className={BUTTON_PRIMARY_COMPACT}
            >
              {saving ? "กำลังบันทึก…" : RENTAL_SETTLEMENT_CORRECT_CONFIRM_LABEL}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={BUTTON_SECONDARY_COMPACT}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${BUTTON_SECONDARY_COMPACT} mt-3`}
        >
          {RENTAL_SETTLEMENT_CORRECT_LABEL}
        </button>
      )}
    </li>
  );
}
