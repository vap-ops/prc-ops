// Spec 119 / ADR 0045 — VAT capture for purchases. The user enters a price and
// picks a mode; the form stores the GROSS (amount is canonically gross — spend =
// what you pay) plus the rate. net / VAT / gross are DERIVED for display, never
// stored separately (no rounding drift to maintain). Thai standard VAT = 7%.

import { round2 } from "@/lib/format";

/** Thai standard VAT rate (%). */
export const VAT_RATE = 7;

export type VatMode = "inclusive" | "exclusive" | "none";

/** The rate to STORE for a chosen mode — none keeps no VAT (0). */
export function rateForMode(mode: VatMode): number {
  return mode === "none" ? 0 : VAT_RATE;
}

/**
 * The GROSS to store from what the user typed:
 *   - exclusive: the entry is net → add VAT;
 *   - inclusive / none: the entry already is the gross.
 */
export function grossFromEntry(value: number, mode: VatMode, rate: number): number {
  if (mode === "exclusive") return round2(value * (1 + rate / 100));
  return round2(value);
}

/**
 * Spec 280 — a SOFT mismatch worth a non-blocking warning: the chosen supplier is
 * explicitly NOT VAT-registered (`is_vat_registered === false`) yet a VAT rate is
 * being applied. Input VAT (acct 1300) is only claimable from a VAT-registered
 * supplier's tax invoice (ใบกำกับภาษี), so the pairing is likely a mistake — but
 * the per-invoice rate stays authoritative, so this only WARNS, never blocks.
 * Unknown VAT status (null/undefined) does NOT warn (avoid false alarms on
 * incomplete master data).
 */
export function isNonVatVatMismatch(
  supplierIsVatRegistered: boolean | null | undefined,
  rate: number,
): boolean {
  return supplierIsVatRegistered === false && rate > 0;
}

export interface VatBreakdown {
  net: number;
  vat: number;
  gross: number;
}

/**
 * Split a stored gross into net + VAT (rate 0 → all net). net and VAT always sum
 * back to the gross: VAT is the remainder after the rounded net.
 */
export function deriveVatBreakdown(gross: number, rate: number): VatBreakdown {
  if (rate <= 0) return { net: gross, vat: 0, gross };
  const net = round2(gross / (1 + rate / 100));
  return { net, vat: round2(gross - net), gross };
}
