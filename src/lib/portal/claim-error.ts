// Spec 130 U3 — pure: claim_contractor_invite RPC raise messages → Thai. Kept
// out of the "use server" actions module (a server-action file may only export
// async functions).

const GENERIC = "รับสิทธิ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export function claimErrorToThai(message: string): string {
  if (message.includes("only a visitor")) return "บัญชีนี้ใช้รับสิทธิ์ไม่ได้ (เป็นผู้ใช้ภายในระบบ)";
  if (message.includes("already bound")) return "บัญชีนี้ผูกกับผู้รับเหมาแล้ว";
  if (message.includes("already used")) return "ลิงก์นี้ถูกใช้ไปแล้ว";
  if (message.includes("expired")) return "ลิงก์หมดอายุแล้ว";
  if (message.includes("invalid token")) return "ลิงก์ไม่ถูกต้อง";
  return GENERIC;
}
