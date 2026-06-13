// Spec 72 — the generic notes validator shared by every entity's notes
// field (the generalization of validateWorkPackageNotes). Trim;
// empty/blank/nullish → null (a cleared note); cap at `max` (default 1000,
// the app cap matching the spec-48 requester-notes cap; the DB CHECK at
// 2000 on each column is the abuse backstop).

export const NOTES_MAX = 1000;

export type ValidateNotesResult = { ok: true; value: string | null } | { ok: false; error: string };

export function validateNotes(
  raw: string | null | undefined,
  max: number = NOTES_MAX,
): ValidateNotesResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > max) {
    return { ok: false, error: `หมายเหตุต้องไม่เกิน ${max} ตัวอักษร` };
  }
  return { ok: true, value: trimmed };
}
