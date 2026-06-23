// Spec 191 U1 — Thai phone + tax-id format/validate helpers.
//
// Pure, dependency-free, importable from BOTH the client (the contact form field
// inputs format as the user types) and the server (the contact actions
// canonicalize + validate on write). Storage is the FORMATTED string (what the
// user sees), re-derived from digits so it is always canonical regardless of how
// it was pasted.
//
// Phone: 10 digits, leading 0 (Thai mobile 08X/09X + landline 0X). Display 3-3-4
// (0XX-XXX-XXXX). Tax id: the 13-digit Thai taxpayer/VAT number, display 1-4-5-2-1.

/** Strip everything but digits. */
export function digitsOnly(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Exactly 10 digits, leading 0 — accepts raw or dash-formatted input. */
export function isValidThaiPhone(value: string): boolean {
  return /^0\d{9}$/.test(digitsOnly(value));
}

/** Progressive 3-3-4 grouping, capped at 10 digits. Junk → digits only. */
export function formatThaiPhone(value: string): string {
  const d = digitsOnly(value).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Exactly 13 digits — accepts raw or dash-formatted input. */
export function isValidThaiTaxId(value: string): boolean {
  return /^\d{13}$/.test(digitsOnly(value));
}

/** Progressive 1-4-5-2-1 grouping, capped at 13 digits. */
export function formatThaiTaxId(value: string): string {
  const d = digitsOnly(value).slice(0, 13);
  const parts = [d.slice(0, 1), d.slice(1, 5), d.slice(5, 10), d.slice(10, 12), d.slice(12, 13)];
  return parts.filter((p) => p.length > 0).join("-");
}
