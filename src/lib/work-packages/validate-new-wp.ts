// Spec 142 U4 — validators for the in-app "add work package" form. The
// create_work_package RPC re-checks (22023 empty / > max) and the composite
// unique (project_id, code) constraint is the real guard; this module is the
// form's fast feedback.

export const WP_CODE_MAX = 50;
export const WP_NAME_MAX = 200;

export type ValidateWpCodeResult = { ok: true; code: string } | { ok: false; error: string };
export type ValidateWpNameResult = { ok: true; name: string } | { ok: false; error: string };

export function validateWorkPackageCode(raw: string): ValidateWpCodeResult {
  const code = raw.trim();
  if (code.length === 0) return { ok: false, error: "กรุณาใส่รหัสงาน" };
  if (code.length > WP_CODE_MAX) {
    return { ok: false, error: `รหัสงานต้องไม่เกิน ${WP_CODE_MAX} ตัวอักษร` };
  }
  return { ok: true, code };
}

export function validateWorkPackageName(raw: string): ValidateWpNameResult {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: "กรุณาใส่ชื่องาน" };
  if (name.length > WP_NAME_MAX) {
    return { ok: false, error: `ชื่องานต้องไม่เกิน ${WP_NAME_MAX} ตัวอักษร` };
  }
  return { ok: true, name };
}
