// Spec 149 U5 / ADR 0057 decision 8 — pure billing breakdown for a งวด progress
// claim. The UI gate before certify_client_billing; the certify RPC mirrors this
// math (and snapshots the amounts). Rates are PERCENT (consistent with
// purchase_requests.vat_rate): retention 5, VAT 7, WHT 3. Amounts round to 2dp.
//
// Posting (decision 8): Dr AR net + Dr Retention-recv + Dr WHT-prepaid /
// Cr Revenue gross + Cr Output VAT. Balances because
// net + retention + wht == gross + vat (net = gross + vat − retention − wht).

import { round2 } from "@/lib/format";

export interface BillingInput {
  grossAmount: number;
  retentionRate: number;
  vatRate: number;
  whtRate: number;
}

export interface BillingBreakdown {
  retentionAmount: number;
  vatAmount: number;
  whtSuffered: number;
  netReceivable: number;
}

export type ComputeBillingResult =
  | { ok: true; value: BillingBreakdown }
  | { ok: false; error: string };

function rateOk(r: number): boolean {
  return Number.isFinite(r) && r >= 0 && r <= 100;
}

export function computeBillingBreakdown(input: BillingInput): ComputeBillingResult {
  const { grossAmount, retentionRate, vatRate, whtRate } = input;

  if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
    return { ok: false, error: "มูลค่างานต้องมากกว่า 0" };
  }
  if (!rateOk(retentionRate)) {
    return { ok: false, error: "อัตราเงินประกันผลงานไม่ถูกต้อง (0–100)" };
  }
  if (!rateOk(vatRate)) {
    return { ok: false, error: "อัตราภาษีมูลค่าเพิ่มไม่ถูกต้อง (0–100)" };
  }
  if (!rateOk(whtRate)) {
    return { ok: false, error: "อัตราภาษีหัก ณ ที่จ่ายไม่ถูกต้อง (0–100)" };
  }

  const retentionAmount = round2((grossAmount * retentionRate) / 100);
  const vatAmount = round2((grossAmount * vatRate) / 100);
  const whtSuffered = round2((grossAmount * whtRate) / 100);
  const netReceivable = round2(grossAmount + vatAmount - retentionAmount - whtSuffered);

  return { ok: true, value: { retentionAmount, vatAmount, whtSuffered, netReceivable } };
}
