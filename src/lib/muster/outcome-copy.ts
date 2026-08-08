// Spec 400 — outcome-code -> Thai sentence maps shared by the muster correction
// forms. REOPEN_ERROR_COPY and ADD_ERROR_COPY moved out of
// `/team/attendance/page.tsx` (which owned them originally, spec 397 U3 / 400
// U3c-b) so the U6a fix page can show the SAME sentences for the SAME outcomes
// instead of drifting a second copy of either. CLOSE_ERROR_COPY stayed local to
// that page — the fix page has no close control of its own.
//
// Every arm follows the honest-copy rule (spec 397 U3): none may say ลองใหม่
// unless the next attempt could genuinely succeed unchanged. A code, never a
// sentence, travels back in the URL — a Thai message there is unbounded,
// survives in history, and would let a crafted link render attacker-chosen
// text inside the app's own error notice.

/**
 * Why a recorded check-out cannot be retimed, said once.
 *
 * Two surfaces state this same fact — the retime form disables its out-field
 * and explains why BEFORE the tap, and `RETIME_ERROR_COPY.locked` answers a
 * hand-posted submit that got past the disabled input. They were duplicated
 * verbatim; a term used in two places belongs in one home (the UI-term SSOT
 * rule), or the two drift and the form promises something the server denies.
 */
export const OUT_LOCKED_COPY = "เวลาออกนี้บันทึกโดยคนแล้ว แก้ไขไม่ได้ — ต้องลบแล้วเพิ่มใหม่";

/** Spec 397 U3 — the reopen outcome codes. */
export const REOPEN_ERROR_COPY: Record<string, string> = {
  denied: "บัญชีนี้ไม่มีสิทธิ์เปิดวันที่ปิดแล้ว",
  wages: "วันนี้บันทึกค่าแรงไปแล้ว ต้องยกเลิกค่าแรงก่อนจึงจะเปิดวันใหม่ได้",
  notclosed: "วันนี้ยังไม่ได้ปิด จึงไม่ต้องเปิดใหม่",
  shape: "วันที่หรือโครงการไม่ถูกต้อง และต้องระบุเหตุผลด้วย",
  failed: "เปิดวันอีกครั้งไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบพร้อมวันที่และชื่อโครงการ",
};

/** Spec 400 U3c-b — the add form's outcomes. */
export const ADD_ERROR_COPY: Record<string, string> = {
  denied: "บัญชีนี้ไม่มีสิทธิ์แก้ไขการเช็คชื่อของโครงการนี้",
  shape: "ข้อมูลที่ส่งไม่ถูกต้อง",
  closed: "ปิดวันแล้ว — ต้องเปิดวันดังกล่าวอีกครั้งก่อน",
  duplicate: "ช่างคนนี้มีการเช็คชื่อของวันดังกล่าวอยู่แล้ว",
  noteam: "ไม่พบทีมของวันดังกล่าว",
  failed: "เพิ่มไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบพร้อมวันที่และชื่อช่าง",
};

/**
 * Spec 400 U6a — retiming an EXISTING session via `muster_correct_session`'s
 * update path. Distinct from ADD_ERROR_COPY's `closed`: retime is offered even
 * on a closed day (its guard is the unbooked-wage anti-join, not closure), so
 * a closed day is never why this map's `denied`/`bounds` fire.
 */
export const RETIME_ERROR_COPY: Record<string, string> = {
  denied: "บัญชีนี้ไม่มีสิทธิ์แก้ไขเวลาของโครงการนี้",
  shape: "ต้องระบุเวลาที่จะแก้ไขอย่างน้อยหนึ่งช่อง",
  bounds:
    "เวลาที่กรอกไม่ถูกต้อง (ต้องอยู่ในวันทำงานนี้ ไม่เกินเวลาปัจจุบัน และเวลาออกต้องไม่ก่อนเวลาเข้า)",
  locked: OUT_LOCKED_COPY,
  booked: "ค่าแรงบันทึกไปแล้ว แก้ไขเวลาไม่ได้",
  stale: "ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดหน้านี้ใหม่แล้วลองอีกครั้ง",
  failed: "แก้เวลาไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบพร้อมวันที่และชื่อช่าง",
};

/**
 * Spec 404 U2 — the reader that turns a redirect's outcome CODE back into the
 * `{ok}` / `{ok:false, message}` shape every correction panel renders.
 *
 * Hoisted out of `/team/attendance/page.tsx`, where spec 400 U7 wrote it, the
 * moment a SECOND surface (the calendar's own `?fix=` panel) began reading the
 * same six params back from the same five actions. Copying eight lines of
 * param-parsing would be exactly the drift `OUT_LOCKED_COPY` above exists to
 * prevent, one layer down: the halves that decide whether an error is SHOWN.
 *
 * ⚠️ The `string[]` arm is load-bearing. A repeated key (`?retimed=1&retimed=1`)
 * arrives as an array, and a bare `=== "1"` on it is false — so a success banner
 * would silently not render. Same class as the `#fragment` bug `returnWith`
 * exists for: the outcome is computed, and then nobody sees it.
 */
export function firstParam(value: unknown): string | undefined {
  return Array.isArray(value)
    ? typeof value[0] === "string"
      ? value[0]
      : undefined
    : typeof value === "string"
      ? value
      : undefined;
}

export type FormOutcome = { ok: true } | { ok: false; message: string } | null;

/** `null` when the URL carries neither half — the form has not run yet. */
export function readOutcome(ok: unknown, err: unknown, copy: Record<string, string>): FormOutcome {
  if (firstParam(ok) === "1") return { ok: true };
  const code = firstParam(err);
  if (code === undefined || code.length === 0) return null;
  // An unknown code falls to `failed` rather than rendering nothing: a refusal
  // that shows no message is indistinguishable from a success.
  return { ok: false, message: copy[code] ?? copy.failed! };
}

/** Spec 400 U6a — deleting a session via `muster_undo_scan`. */
export const UNDO_ERROR_COPY: Record<string, string> = {
  denied: "บัญชีนี้ไม่มีสิทธิ์ลบการเช็คชื่อนี้",
  shape: "ข้อมูลที่ส่งไม่ถูกต้อง",
  gone: "ไม่พบการเช็คชื่อนี้แล้ว — อาจถูกลบไปก่อนหน้านี้",
  closed: "ปิดวันแล้ว — ต้องเปิดวันดังกล่าวอีกครั้งก่อนจึงจะลบได้",
  booked: "ค่าแรงบันทึกไปแล้ว ลบไม่ได้",
  otFirst: "มี OT ของวันนี้อยู่ — ต้องลบ OT ก่อน",
  failed: "ลบไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบพร้อมวันที่และชื่อช่าง",
};
