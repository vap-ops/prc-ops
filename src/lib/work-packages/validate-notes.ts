// Spec 71 — work-package notes (backup capture). Pure validator the
// server action relays through. Trim; empty/blank/nullish → null (a
// cleared note); 1000-char app cap (matches the spec-48 requester-notes
// cap; the DB CHECK at 2000 is the abuse backstop). Keep the cap literal
// here so both the test and the action share one source.

export const WORK_PACKAGE_NOTES_MAX = 1000;

export type ValidateNotesResult = { ok: true; value: string | null } | { ok: false; error: string };

export function validateWorkPackageNotes(raw: string | null | undefined): ValidateNotesResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > WORK_PACKAGE_NOTES_MAX) {
    return { ok: false, error: `หมายเหตุต้องไม่เกิน ${WORK_PACKAGE_NOTES_MAX} ตัวอักษร` };
  }
  return { ok: true, value: trimmed };
}
