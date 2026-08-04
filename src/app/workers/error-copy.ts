// Honest error copy for the /workers roster actions. A leaf module (NOT
// "use server") because actions.ts is a Server Actions file and may only export
// async functions — these string constants have to live outside it so both the
// action and its test can import them. See feedback e6b48386.
//
// "ลองใหม่" is reserved for a genuine transient — an actionable cause names itself
// instead (a session lost mid-deploy read identically to bad data).
export const GENERIC_ERROR = "บันทึกช่างไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
export const INVALID_NAME_ERROR = "กรุณากรอกชื่อช่างให้ถูกต้อง";
export const INVALID_RATE_ERROR = "กรุณากรอกค่าแรงต่อวันเป็นตัวเลข (เช่น 400)";
// The DEFINER RPCs raise 42501 when the caller's role can't be resolved — which is
// what an expired/half-refreshed session looks like on a back-office-gated action
// (the UI audience == the RPC's is_back_office gate, so a 42501 means the session,
// not the person, lost authority). Tell the user to re-auth, not to retry.
export const SESSION_LOST_ERROR = "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่แล้วบันทึกอีกครั้ง";

// Map a worker-RPC error to user copy — ONLY for the back-office-gated actions
// (create/update/day-rate). The narrower-gated actions (level/HT/assign) keep the
// generic copy, since there a 42501 can be a genuine denial rather than a lost
// session. Everything else stays the transient "ลองใหม่".
export function workerRpcError(error: { code?: string } | null): string {
  return error?.code === "42501" ? SESSION_LOST_ERROR : GENERIC_ERROR;
}
