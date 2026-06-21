// Spec 170 U4b — pure validation for a DC worker's self-edited portal profile
// (ADR 0062: a DC is a worker, so the profile lives on the worker). Contact
// (phone/email) + emergency contact (name/relation/phone) + DOB. All optional —
// a blank value clears that field. Caps mirror the workers CHECKs (phone ≤50,
// email ≤200, emergency name ≤120, relation ≤60). The update_own_worker_profile
// RPC re-scopes to the caller's own worker; this is shape/UX validation only.

export interface WorkerProfileInput {
  phone?: string;
  email?: string;
  emergencyName?: string;
  emergencyRelation?: string;
  emergencyPhone?: string;
  dob?: string;
}

// Deliberately loose — accept what a person plausibly types, reject only clear
// mistakes. Requires text@text.tld with no whitespace.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Round-trip the components so impossible days ("2026-02-31") are rejected
// (Date.parse is lenient about overflow).
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

export function validateWorkerProfile(input: WorkerProfileInput): string | null {
  const phone = (input.phone ?? "").trim();
  const email = (input.email ?? "").trim();
  const emergencyName = (input.emergencyName ?? "").trim();
  const emergencyRelation = (input.emergencyRelation ?? "").trim();
  const emergencyPhone = (input.emergencyPhone ?? "").trim();
  const dob = (input.dob ?? "").trim();

  if (phone) {
    if (phone.length > 50) return "เบอร์โทรยาวเกินไป";
    if (!/\d/.test(phone)) return "เบอร์โทรไม่ถูกต้อง";
  }
  if (email) {
    if (email.length > 200) return "อีเมลยาวเกินไป";
    if (!EMAIL_RE.test(email)) return "อีเมลไม่ถูกต้อง";
  }
  if (emergencyName.length > 120) return "ชื่อยาวเกินไป";
  if (emergencyRelation.length > 60) return "ความสัมพันธ์ยาวเกินไป";
  if (emergencyPhone) {
    if (emergencyPhone.length > 50) return "เบอร์โทรยาวเกินไป";
    if (!/\d/.test(emergencyPhone)) return "เบอร์โทรไม่ถูกต้อง";
  }
  if (dob && !isIsoDate(dob)) return "วันเกิดไม่ถูกต้อง";
  return null;
}
