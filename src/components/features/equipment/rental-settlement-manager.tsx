"use client";

// Spec 275 U3 / 323 U1c — the rental SETTLEMENT history list on /equipment/rentals
// (BACK_OFFICE money audience only; the page gate keeps a field session out entirely,
// so vendor invoice figures may render here). Recording a settlement moved into
// AddSettlementFab + a bottom sheet (operator 2026-07-15: forms off the list); this
// component now only lists the live settlements (supersede anti-join done in the
// page). แก้ไข opens a prefilled correction form IN A BOTTOM SHEET that supersedes the
// row (append-only + supersede, never UPDATE). Writes go through the SECURITY DEFINER
// RPCs via the server actions.
//
// 'use client' justification: per-row sheet-hosted correction form with busy/error.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { bahtWithSymbol } from "@/lib/format";
import {
  formatThaiDate,
  RECEIPT_METHOD_LABEL,
  RENTAL_SETTLEMENT_CORRECT_CONFIRM_LABEL,
  RENTAL_SETTLEMENT_CORRECT_LABEL,
  RENTAL_SETTLEMENT_CORRECTION_REASON_LABEL,
  RENTAL_SETTLEMENT_EMPTY_LABEL,
  RENTAL_SETTLEMENT_HISTORY_LABEL,
  RENTAL_SETTLEMENT_ZERO_CANCELS_HINT,
} from "@/lib/i18n/labels";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_STACKED,
  INLINE_ERROR,
  SECTION_HEADING,
} from "@/lib/ui/classes";
import { supersedeRentalSettlement } from "@/app/equipment/rentals/actions";
import type { RentalReceiptPurpose } from "@/app/equipment/rentals/receipt-actions";
import {
  AMOUNTS_ERROR,
  AmountInputs,
  parseAmounts,
  type AmountFields,
} from "@/components/features/equipment/rental-settlement-form";
import { RentalReceiptUploader } from "@/components/features/equipment/rental-receipt-uploader";
import type { ReceiptMethod, SettlementListItem } from "@/lib/equipment/rental-settlement-view";

// Spec 323 U1d — a signed, viewable receipt document attached to a settlement (the
// vendor tax invoice / payment slip). Purpose labels are kept LOCAL (not labels.ts)
// to avoid contending the shared SSOT with the concurrently-active 321profile lane;
// promote if a second surface reuses them.
export interface RentalReceiptView {
  id: string;
  purpose: RentalReceiptPurpose;
  uploadedAt: string;
  url: string | null;
}
const RECEIPT_PURPOSE_LABEL: Record<RentalReceiptPurpose, string> = {
  payment_slip: "สลิปโอนเงิน",
  tax_invoice: "ใบกำกับภาษี",
};
const RECEIPT_DOCS_LABEL = "ใบเสร็จ/เอกสาร";
const RECEIPT_EMPTY_LABEL = "ยังไม่มีเอกสารแนบ";
const RECEIPT_VIEW_LABEL = "ดูเอกสาร";
const RECEIPT_ATTACH_SLIP_LABEL = "แนบสลิปโอนเงิน";
const RECEIPT_ATTACH_INVOICE_LABEL = "แนบใบกำกับภาษี";

export function RentalSettlementManager({
  settlements,
  receiptsBySettlement = {},
}: {
  settlements: SettlementListItem[];
  // Spec 323 U1d: signed receipt views keyed by settlement id (admin-read + signed on
  // the page). A settlement with no attachments simply maps to nothing.
  receiptsBySettlement?: Record<string, RentalReceiptView[]>;
}) {
  const router = useRouter();
  return (
    <section aria-label={RENTAL_SETTLEMENT_HISTORY_LABEL}>
      <h2 className={SECTION_HEADING}>{RENTAL_SETTLEMENT_HISTORY_LABEL}</h2>
      {settlements.length === 0 ? (
        <p className="text-ink-muted text-sm">{RENTAL_SETTLEMENT_EMPTY_LABEL}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {settlements.map((s) => (
            <SettlementRow
              key={s.id}
              settlement={s}
              receipts={receiptsBySettlement[s.id] ?? []}
              onChanged={() => router.refresh()}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SettlementRow({
  settlement,
  receipts,
  onChanged,
}: {
  settlement: SettlementListItem;
  receipts: RentalReceiptView[];
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
  // Spec 323 U1d — the receipt-documents sheet (view attached + attach new).
  const [receiptsOpen, setReceiptsOpen] = useState(false);

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

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setOpen(true)} className={BUTTON_SECONDARY_COMPACT}>
          {RENTAL_SETTLEMENT_CORRECT_LABEL}
        </button>
        <button
          type="button"
          onClick={() => setReceiptsOpen(true)}
          className={BUTTON_SECONDARY_COMPACT}
        >
          {receipts.length > 0 ? `${RECEIPT_DOCS_LABEL} (${receipts.length})` : RECEIPT_DOCS_LABEL}
        </button>
      </div>

      <BottomSheet
        open={open}
        title={RENTAL_SETTLEMENT_CORRECT_LABEL}
        onClose={() => setOpen(false)}
      >
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
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSupersede}
            disabled={saving}
            className={BUTTON_PRIMARY_COMPACT}
          >
            {saving ? "กำลังบันทึก…" : RENTAL_SETTLEMENT_CORRECT_CONFIRM_LABEL}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY_COMPACT}>
            ยกเลิก
          </button>
        </div>
      </BottomSheet>

      {/* Spec 323 U1d — the receipt-documents sheet: view the attached vendor
          documents (signed URLs) + attach a new สลิป / ใบกำกับภาษี. */}
      <BottomSheet
        open={receiptsOpen}
        title={RECEIPT_DOCS_LABEL}
        onClose={() => setReceiptsOpen(false)}
      >
        {receipts.length === 0 ? (
          <p className="text-ink-muted text-sm">{RECEIPT_EMPTY_LABEL}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3">
                <span className="text-ink-secondary text-sm">
                  {`${RECEIPT_PURPOSE_LABEL[r.purpose]} · ${formatThaiDate(r.uploadedAt)}`}
                </span>
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={BUTTON_SECONDARY_COMPACT}
                  >
                    {RECEIPT_VIEW_LABEL}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className="border-edge mt-4 flex flex-col gap-2 border-t pt-4">
          <RentalReceiptUploader
            settlementId={settlement.id}
            purpose="payment_slip"
            label={RECEIPT_ATTACH_SLIP_LABEL}
            onUploaded={onChanged}
          />
          <RentalReceiptUploader
            settlementId={settlement.id}
            purpose="tax_invoice"
            label={RECEIPT_ATTACH_INVOICE_LABEL}
            onUploaded={onChanged}
          />
        </div>
      </BottomSheet>
    </li>
  );
}
