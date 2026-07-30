// Spec 380 U2 — the doc-chase SSOT: which accounting document an order still
// owes, per supplier class (§2, operator decisions 2026-07-30). Pure, no IO —
// every surface (chase page, hub chip, row chips, the U6 RPC fix) derives from
// here; local re-derivations are the drift this module exists to prevent (§6).
//
// RD grounding (spec §2): a VAT-registered vendor's order is discharged ONLY by
// a full tax invoice (ม.86/4 — the input-VAT claim). Everyone else's by the
// fallback ladder documents (ม.105 ทวิ receipt/cash bill · ใบสำคัญรับเงิน ·
// ใบรับรองแทนใบเสร็จรับเงิน). Delivery notes and transfer slips prove goods and
// payment, never the payee (ม.65 ตรี (18)) — they NEVER satisfy.

import type { Database } from "@/lib/db/database.types";
import { DOC_CHASE_ASK_NON_VAT, DOC_CHASE_ASK_UNKNOWN, DOC_CHASE_ASK_VAT } from "@/lib/i18n/labels";

export type PurchaseDocType = Database["public"]["Enums"]["purchase_doc_type"];
export type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export type DocRequirementClass = "vat" | "non_vat" | "unknown";

export type DocCoverage = "out_of_scope" | "covered_typed" | "covered_loose" | "waived" | "missing";

export interface DocAttachment {
  /** null = legacy untyped upload (pre-380) — covered-loose via purpose only. */
  docType: PurchaseDocType | null;
  source: "pr" | "po";
  purpose: string;
}

/** Money spent AND goods received — the §3 scope line. */
export const IN_SCOPE_STATUSES: readonly PurchaseRequestStatus[] = ["delivered", "site_purchased"];

/**
 * suppliers.is_vat_registered is NOT NULL, so a null here means NO supplier
 * row at all (free-text pr.supplier only) — the only reachable "unknown".
 */
export function docRequirementClass(
  supplier: { isVatRegistered: boolean } | null,
): DocRequirementClass {
  if (supplier === null) return "unknown";
  return supplier.isVatRegistered ? "vat" : "non_vat";
}

const FALLBACK_LADDER_TYPES: readonly PurchaseDocType[] = [
  "tax_invoice_full",
  "receipt_cash_bill",
  "payment_voucher",
  "cert_in_lieu",
];

export const SATISFYING_DOC_TYPES: Record<DocRequirementClass, readonly PurchaseDocType[]> = {
  // Only the full tax invoice discharges a VAT vendor's order — a cash bill
  // here is the exact input-VAT gap this spec exists to close (decision ①).
  vat: ["tax_invoice_full"],
  non_vat: FALLBACK_LADDER_TYPES,
  unknown: FALLBACK_LADDER_TYPES,
};

export const NEVER_SATISFYING: readonly PurchaseDocType[] = [
  "delivery_note",
  "transfer_slip",
  "other",
];

/** Untyped legacy purposes that grandfather as covered-loose (§2 decision ②). */
export const LOOSE_PR_PURPOSES: readonly string[] = ["invoice", "payment"];
const LOOSE_PO_PURPOSE = "source_document";

export function docCoverage(input: {
  status: PurchaseRequestStatus;
  cls: DocRequirementClass;
  attachments: readonly DocAttachment[];
  waived: boolean;
}): DocCoverage {
  if (!IN_SCOPE_STATUSES.includes(input.status)) return "out_of_scope";

  const satisfying = SATISFYING_DOC_TYPES[input.cls];
  const hasTyped = input.attachments.some(
    (a) => a.docType !== null && satisfying.includes(a.docType),
  );
  if (hasTyped) return "covered_typed";

  const hasLoose = input.attachments.some(
    (a) =>
      a.docType === null &&
      (a.source === "pr" ? LOOSE_PR_PURPOSES.includes(a.purpose) : a.purpose === LOOSE_PO_PURPOSE),
  );
  if (hasLoose) return "covered_loose";

  // A waiver discharges an order nothing else covers; it never masks a real doc.
  if (input.waived) return "waived";
  return "missing";
}

export function chaseAsk(cls: DocRequirementClass): string {
  switch (cls) {
    case "vat":
      return DOC_CHASE_ASK_VAT;
    case "non_vat":
      return DOC_CHASE_ASK_NON_VAT;
    case "unknown":
      return DOC_CHASE_ASK_UNKNOWN;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days since the order's aging anchor (delivered → purchased → created).
 * Compares instants, never strings — the two sides come from different
 * producers (PostgREST `+00:00` vs JS `Z`; spec-375 boundary lesson).
 */
export function agingDays(
  nowMs: number,
  deliveredAt: string | null,
  purchasedAt: string | null,
  createdAt: string,
): number {
  const anchor = deliveredAt ?? purchasedAt ?? createdAt;
  return Math.max(0, Math.floor((nowMs - Date.parse(anchor)) / DAY_MS));
}
