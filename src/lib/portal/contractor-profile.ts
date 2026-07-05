// Spec 132 U1 — pure validation for the portal user's self-edited contactability
// fields (portal). Thai, portal-facing. Caps mirror the contractors CHECKs
// (contact_person ≤120, email ≤200, mailing_address ≤500); phone ≤30 like the
// emergency phone. All fields optional — a blank value clears that field. The
// update_own_contractor_profile RPC re-scopes to the caller's own contractor;
// this is shape/UX validation only.

export interface ContractorProfileInput {
  phone?: string;
  email?: string;
  contactPerson?: string;
  mailingAddress?: string;
}

// Deliberately loose — accept what a person plausibly types, reject only clear
// mistakes. Requires text@text.tld with no whitespace.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContractorProfile(input: ContractorProfileInput): string | null {
  const phone = (input.phone ?? "").trim();
  const email = (input.email ?? "").trim();
  const contactPerson = (input.contactPerson ?? "").trim();
  const mailingAddress = (input.mailingAddress ?? "").trim();

  if (phone) {
    if (phone.length > 30) return "เบอร์โทรยาวเกินไป";
    if (!/\d/.test(phone)) return "เบอร์โทรไม่ถูกต้อง";
  }
  if (email) {
    if (email.length > 200) return "อีเมลยาวเกินไป";
    if (!EMAIL_RE.test(email)) return "อีเมลไม่ถูกต้อง";
  }
  if (contactPerson.length > 120) return "ชื่อผู้ติดต่อยาวเกินไป";
  if (mailingAddress.length > 500) return "ที่อยู่ยาวเกินไป";
  return null;
}
