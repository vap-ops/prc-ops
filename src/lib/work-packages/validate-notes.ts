// Spec 71 — work-package notes validator. Spec 72: now a thin wrapper over
// the generic src/lib/notes/validate.ts (the cap + trim→null logic is
// identical across every entity). Kept as a named export so the WP action
// and its test stay green.

import { NOTES_MAX, validateNotes, type ValidateNotesResult } from "@/lib/notes/validate";

export type { ValidateNotesResult };

export const WORK_PACKAGE_NOTES_MAX = NOTES_MAX;

export function validateWorkPackageNotes(raw: string | null | undefined): ValidateNotesResult {
  return validateNotes(raw, WORK_PACKAGE_NOTES_MAX);
}
