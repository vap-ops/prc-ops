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

// Field incident 2026-08-04: `workers.tax_id` carries a UNIQUE index
// (`workers_tax_id_unique`, partial on NOT NULL), so re-adding someone already on the
// roster raises 23505 — verified live with a rollback-wrapped probe. That is a
// PERMANENT refusal: the old generic copy asked the user to repeat an action that can
// never succeed, and named neither the cause nor the person collided with.
export const DUPLICATE_TAX_ID_ERROR =
  "เลขบัตรประชาชนนี้มีอยู่แล้วในระบบ — ช่างคนนี้ถูกเพิ่มไว้ก่อนแล้ว กรุณาค้นหาในทะเบียนแล้วแก้ที่แถวเดิม";
// Any other unique violation (employee_id, user_id) is equally permanent; we cannot
// name the column, but we can still refuse honestly instead of inviting a retry.
export const DUPLICATE_GENERIC_ERROR =
  "ข้อมูลนี้ซ้ำกับช่างที่มีอยู่แล้วในระบบ กรุณาตรวจสอบทะเบียนแล้วแก้ที่แถวเดิม";

// The add sheet's client-side pre-check can do better than the server: the roster
// page already ships every worker's tax_id to the browser, so the collision is
// knowable before the round trip AND the person can be named.
export function duplicateTaxIdOwnerError(name: string): string {
  return `เลขบัตรประชาชนนี้เป็นของ ${name} ซึ่งอยู่ในทะเบียนแล้ว กรุณาแก้ที่แถวเดิมแทนการเพิ่มใหม่`;
}

// A dead transport IS transient, so this one keeps "ลองใหม่" honestly. It exists
// because `void submit()` used to swallow the throw entirely: the button stayed
// disabled reading กำลังบันทึก… with no message at all (the 2026-07-27 SA incident,
// same shape).
export const ADD_WORKER_NETWORK_ERROR = "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบสัญญาณแล้วลองใหม่อีกครั้ง";

// Map a worker-RPC error to user copy — ONLY for the back-office-gated actions
// (create/update/day-rate). The narrower-gated actions (level/HT/assign) keep the
// generic copy, since there a 42501 can be a genuine denial rather than a lost
// session. Everything else stays the transient "ลองใหม่".
export function workerRpcError(error: { code?: string; message?: string } | null): string {
  if (error?.code === "42501") return SESSION_LOST_ERROR;
  if (error?.code === "23505") {
    // PostgREST forwards Postgres's message verbatim, which names the index. Match on
    // the index rather than the column: `details` ("Key (tax_id)=…") is redacted on
    // some deployments, the message never is.
    return error.message?.includes("workers_tax_id_unique")
      ? DUPLICATE_TAX_ID_ERROR
      : DUPLICATE_GENERIC_ERROR;
  }
  return GENERIC_ERROR;
}
