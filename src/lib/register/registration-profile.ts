// Spec 263 U2 — pure validation for the applicant's progressive registration
// profile (full_name, phone, date_of_birth, emergency contact name/relation/
// phone). Mirrors src/lib/portal/worker-profile.ts's shape/UX. Every field is
// optional (progressive fill, spec doc: "applicant-supplied fields are
// nullable") — update_own_technician_registration re-scopes to the caller's own
// row; this is shape/UX validation only. Length caps mirror the workers/portal
// precedent (name <=120, phone <=50, relation <=60).

export interface RegistrationProfileInput {
  fullName?: string;
  phone?: string;
  dob?: string;
  emergencyName?: string;
  emergencyRelation?: string;
  emergencyPhone?: string;
}

// Round-trip the components so impossible days ("2026-02-31") are rejected
// (Date.parse is lenient about overflow) — same helper shape as worker-profile.ts.
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

export function validateRegistrationProfile(input: RegistrationProfileInput): string | null {
  const fullName = (input.fullName ?? "").trim();
  const phone = (input.phone ?? "").trim();
  const dob = (input.dob ?? "").trim();
  const emergencyName = (input.emergencyName ?? "").trim();
  const emergencyRelation = (input.emergencyRelation ?? "").trim();
  const emergencyPhone = (input.emergencyPhone ?? "").trim();

  if (fullName.length > 120) return "ชื่อยาวเกินไป";
  if (phone) {
    if (phone.length > 50) return "เบอร์โทรยาวเกินไป";
    if (!/\d/.test(phone)) return "เบอร์โทรไม่ถูกต้อง";
  }
  if (dob && !isIsoDate(dob)) return "วันเกิดไม่ถูกต้อง";
  if (emergencyName.length > 120) return "ชื่อยาวเกินไป";
  if (emergencyRelation.length > 60) return "ความสัมพันธ์ยาวเกินไป";
  if (emergencyPhone) {
    if (emergencyPhone.length > 50) return "เบอร์โทรยาวเกินไป";
    if (!/\d/.test(emergencyPhone)) return "เบอร์โทรไม่ถูกต้อง";
  }
  return null;
}
