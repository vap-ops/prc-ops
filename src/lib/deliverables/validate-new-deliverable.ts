// Spec 164 U1 — validators for the in-app "add งวดงาน" form. The
// create_deliverable RPC re-checks (22023 empty / > max) and the composite
// unique (project_id, code) constraint is the real guard; this module is the
// form's fast feedback. Mirrors validate-new-wp.ts.

export const DELIVERABLE_CODE_MAX = 50;
export const DELIVERABLE_NAME_MAX = 200;

export type ValidateDeliverableCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: string };
export type ValidateDeliverableNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function validateDeliverableCode(raw: string): ValidateDeliverableCodeResult {
  const code = raw.trim();
  if (code.length === 0) return { ok: false, error: "กรุณาใส่รหัสงวด" };
  if (code.length > DELIVERABLE_CODE_MAX) {
    return { ok: false, error: `รหัสงวดต้องไม่เกิน ${DELIVERABLE_CODE_MAX} ตัวอักษร` };
  }
  return { ok: true, code };
}

export function validateDeliverableName(raw: string): ValidateDeliverableNameResult {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "กรุณาใส่ชื่องวด" };
  if (name.length > DELIVERABLE_NAME_MAX) {
    return { ok: false, error: `ชื่องวดต้องไม่เกิน ${DELIVERABLE_NAME_MAX} ตัวอักษร` };
  }
  return { ok: true, name };
}
