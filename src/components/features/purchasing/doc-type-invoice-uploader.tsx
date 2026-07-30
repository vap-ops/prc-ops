"use client";

// Spec 380 U5 — the required-doc-type wrapper around InvoiceUploader. The
// file trigger does not exist until a type is chosen (with no default) or is
// available immediately (with a caller-provided default) — a "required
// select" that still lets you upload untyped isn't required. Reused at every
// doc-chase-relevant InvoiceUploader mount (PR receive/standalone cards,
// procurement grid drawer, self-purchase form) so the gate lives in ONE place.

import { useState } from "react";

import { InvoiceUploader } from "@/components/features/purchasing/invoice-uploader";
import {
  DOC_TYPE_LABEL,
  DOC_TYPE_PICKER_LABEL,
  DOC_TYPE_PICKER_PLACEHOLDER,
} from "@/lib/i18n/labels";
import type { PurchaseDocType } from "@/lib/purchasing/doc-chase";
import { FIELD_SELECT } from "@/lib/ui/classes";

// The four RD-ladder types a human genuinely picks from once goods are
// already paid for (standalone card, drawer, self-purchase) — an accounting
// doc is expected to exist by then.
const STRICT_DOC_TYPES: readonly PurchaseDocType[] = [
  "tax_invoice_full",
  "receipt_cash_bill",
  "payment_voucher",
  "cert_in_lieu",
];

// The receive card's honest superset: a driver may hand over ONLY the
// delivery note, or something the SA can't classify — offering just the
// strict list forces a mislabel (typing delivery_note as receipt_cash_bill
// would flip a currently-fine covered_loose order to missing; typing it
// tax_invoice_full would falsely satisfy a VAT claim). Fresh-eyes catch.
const WIDE_DOC_TYPES: readonly PurchaseDocType[] = [...STRICT_DOC_TYPES, "delivery_note", "other"];

interface DocTypeInvoiceUploaderProps {
  purchaseRequestId: string;
  projectId: string;
  /** null = no default (spec §4 U5 — the receive card's hard rule: a wrong
   *  pre-selection can regress coverage, so that mount passes null). */
  defaultDocType: PurchaseDocType | null;
  label?: string;
  onUploaded?: () => void;
  /** true = offer delivery_note + other too (the receive card's honest
   *  superset). Default false = the strict accounting-doc list. */
  wideTypes?: boolean;
}

export function DocTypeInvoiceUploader({
  purchaseRequestId,
  projectId,
  defaultDocType,
  label,
  onUploaded,
  wideTypes = false,
}: DocTypeInvoiceUploaderProps) {
  const [docType, setDocType] = useState<PurchaseDocType | "">(defaultDocType ?? "");
  const options = wideTypes ? WIDE_DOC_TYPES : STRICT_DOC_TYPES;

  return (
    <div className="flex flex-col gap-2">
      <select
        required
        aria-label={DOC_TYPE_PICKER_LABEL}
        value={docType}
        onChange={(e) => setDocType(e.target.value as PurchaseDocType)}
        className={FIELD_SELECT}
      >
        <option value="" disabled>
          {DOC_TYPE_PICKER_PLACEHOLDER}
        </option>
        {options.map((t) => (
          <option key={t} value={t}>
            {DOC_TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      {docType !== "" ? (
        <InvoiceUploader
          purchaseRequestId={purchaseRequestId}
          projectId={projectId}
          docType={docType}
          {...(label !== undefined ? { label } : {})}
          {...(onUploaded !== undefined ? { onUploaded } : {})}
        />
      ) : null}
    </div>
  );
}
