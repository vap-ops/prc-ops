// Spec 263 U2 — start_technician_registration / update_own_technician_registration /
// add_technician_registration_doc RPC raise messages -> Thai. Mirrors
// src/lib/portal/claim-error.ts's shape. Kept out of the "use server" actions
// module (a server-action file may only export async functions).

const GENERIC = "ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export function registrationErrorToThai(message: string): string {
  if (message.includes("already registered")) return "บัญชีนี้สมัครไปแล้ว";
  if (message.includes("no registration for this user")) return "ยังไม่ได้สมัครเป็นช่าง";
  if (message.includes("registration is no longer pending")) {
    return "ไม่สามารถแก้ไขได้ (สถานะไม่ใช่รออนุมัติ)";
  }
  return GENERIC;
}
