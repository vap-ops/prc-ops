// Spec 207 U3 — validators for the in-app "add หมวดงาน" (project work-category)
// form. The create_project_category RPC re-checks (22023 blank / > max) and the
// composite unique (project_id, code) constraint is the real guard; this module
// is the form's fast feedback. Mirrors validate-new-deliverable.ts. Caps match
// the RPC: code <= 40, name <= 120.

export const CATEGORY_CODE_MAX = 40;
export const CATEGORY_NAME_MAX = 120;

export type ValidateCategoryCodeResult = { ok: true; code: string } | { ok: false; error: string };
export type ValidateCategoryNameResult = { ok: true; name: string } | { ok: false; error: string };

export function validateCategoryCode(raw: string): ValidateCategoryCodeResult {
  const code = raw.trim();
  if (code.length === 0) return { ok: false, error: "กรุณาใส่รหัสหมวดงาน" };
  if (code.length > CATEGORY_CODE_MAX) {
    return { ok: false, error: `รหัสหมวดงานต้องไม่เกิน ${CATEGORY_CODE_MAX} ตัวอักษร` };
  }
  return { ok: true, code };
}

export function validateCategoryName(raw: string): ValidateCategoryNameResult {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "กรุณาใส่ชื่อหมวดงาน" };
  if (name.length > CATEGORY_NAME_MAX) {
    return { ok: false, error: `ชื่อหมวดงานต้องไม่เกิน ${CATEGORY_NAME_MAX} ตัวอักษร` };
  }
  return { ok: true, name };
}
