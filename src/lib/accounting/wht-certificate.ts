// Spec 149 U6 / ADR 0057 decision 9 — pure validation for a withholding-tax
// certificate. The UI gate before record_wht_certificate; the RPC mirrors the
// wht_amount math and re-guards. Rates are PERCENT. tax_id is the Thai 13-digit
// taxpayer id. A deducted cert posts Dr (party payable) / Cr WHT-payable; a
// suffered cert is a document only (the WHT-prepaid already posts at billing).

const round2 = (n: number) => Math.round(n * 100) / 100;

export const WHT_DIRECTIONS = ["deducted", "suffered"] as const;
export type WhtDirection = (typeof WHT_DIRECTIONS)[number];

export const WHT_FORMS = ["pnd3", "pnd53", "pnd1"] as const;
export type WhtForm = (typeof WHT_FORMS)[number];

export interface WhtCertificateInput {
  direction: string;
  taxForm: string;
  taxId: string;
  baseAmount: number;
  whtRate: number;
}

export type ValidateWhtResult =
  | { ok: true; value: { whtAmount: number } }
  | { ok: false; error: string };

const TAX_ID_13 = /^\d{13}$/;

export function validateWhtCertificate(input: WhtCertificateInput): ValidateWhtResult {
  const { direction, taxForm, taxId, baseAmount, whtRate } = input;

  if (!(WHT_DIRECTIONS as readonly string[]).includes(direction)) {
    return { ok: false, error: "ทิศทางภาษีหัก ณ ที่จ่ายไม่ถูกต้อง" };
  }
  if (!(WHT_FORMS as readonly string[]).includes(taxForm)) {
    return { ok: false, error: "แบบยื่นไม่ถูกต้อง (ภ.ง.ด.3/53/1)" };
  }
  if (!TAX_ID_13.test(taxId.trim())) {
    return { ok: false, error: "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก" };
  }
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    return { ok: false, error: "ฐานภาษีต้องมากกว่า 0" };
  }
  if (!Number.isFinite(whtRate) || whtRate < 0 || whtRate > 100) {
    return { ok: false, error: "อัตราภาษีหัก ณ ที่จ่ายไม่ถูกต้อง (0–100)" };
  }

  return { ok: true, value: { whtAmount: round2((baseAmount * whtRate) / 100) } };
}

// Spec 206 — the form's rate resolver, mirroring the RPC's
// coalesce(p_wht_rate, default_rate): a finite explicit override wins (0 included —
// coalesce treats it as a real value, not falsy); otherwise the income type's
// standard rate; an unknown type with no override resolves to null (the RPC raises
// 'unknown income_type' in that case).
export interface WhtRateOption {
  incomeType: string;
  defaultRate: number;
}

export function resolveWhtRate(
  incomeType: string,
  override: number | null,
  rates: readonly WhtRateOption[],
): number | null {
  if (override !== null && Number.isFinite(override)) return override;
  const match = rates.find((r) => r.incomeType === incomeType);
  return match ? match.defaultRate : null;
}
