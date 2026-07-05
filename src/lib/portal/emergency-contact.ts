// Spec 131 U2b — pure validation for the ช่าง's self-edited emergency contact.
// Thai, portal-facing. Length caps mirror the contractors CHECKs
// (name ≤120, relation ≤60, phone ≤30). The RPC re-scopes to own contractor.

export function validateEmergencyContact(input: {
  name: string;
  relation: string;
  phone: string;
}): string | null {
  const name = input.name.trim();
  const relation = input.relation.trim();
  const phone = input.phone.trim();

  if (!name) return "กรุณาระบุชื่อผู้ติดต่อฉุกเฉิน";
  if (name.length > 120) return "ชื่อยาวเกินไป";
  if (relation.length > 60) return "ความสัมพันธ์ยาวเกินไป";
  if (!phone) return "กรุณาระบุเบอร์โทรฉุกเฉิน";
  if (phone.length > 30) return "เบอร์โทรยาวเกินไป";
  if (!/\d/.test(phone)) return "เบอร์โทรไม่ถูกต้อง";
  return null;
}
