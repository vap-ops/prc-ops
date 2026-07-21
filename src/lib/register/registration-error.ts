// Spec 263 U2/U3 — technician_registrations RPC raise messages -> Thai. Covers
// the applicant-facing self-serve RPCs (start / update_own / add_doc, U2) AND
// the back-office approve/reject RPCs (U1c, U3). Mirrors
// src/lib/portal/claim-error.ts's shape. Kept out of the "use server" actions
// module (a server-action file may only export async functions).

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export function registrationErrorToThai(message: string): string {
  if (message.includes("already registered")) return "บัญชีนี้สมัครไปแล้ว";
  if (message.includes("no registration for this user")) return "ยังไม่ได้สมัครเป็นช่าง";
  if (message.includes("registration is no longer pending")) {
    return "ไม่สามารถแก้ไขได้ (สถานะไม่ใช่รออนุมัติ)";
  }
  // Spec 263 U3 — approve_technician_registration / reject_technician_registration
  // (back-office). Order matters: check the more specific messages before the
  // generic role-gate one so no branch shadows another.
  if (message.includes("role not permitted")) return "ไม่มีสิทธิ์ทำรายการนี้";
  // Spec 333 — the defer arm is refused for the field role (its floors feed the
  // workers insert). Checked before the floor messages (distinct substring).
  if (message.includes("deferred documents are not available for the technician role")) {
    return "ส่งเอกสารภายหลังใช้ไม่ได้กับตำแหน่งช่าง";
  }
  if (message.includes("registration not found")) return "ไม่พบคำขอสมัครนี้";
  if (message.includes("registration is not pending")) {
    return "คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติแล้ว (อาจถูกดำเนินการไปแล้ว)";
  }
  if (message.includes("full_name required before approval")) {
    return "อนุมัติไม่ได้: ผู้สมัครยังไม่ได้กรอกชื่อ-นามสกุล";
  }
  if (message.includes("an id_card attachment is required before approval")) {
    return "อนุมัติไม่ได้: ผู้สมัครยังไม่ได้อัปโหลดบัตรประชาชน";
  }
  return GENERIC;
}
