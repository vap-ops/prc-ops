// Spec 396 U3 — telling a NORMALISATION of a person's name apart from a
// REPLACEMENT of the person.
//
// The measurement this exists to serve (2026-08-04): 22 back-office worker
// renames all-time, 11 of them on records belonging to a real person's own
// account — and TEN of those eleven were one bulk pass adding นาย/นาง/นางสาว
// prefixes, ten inside 90 seconds. The eleventh replaced a person and destroyed
// an employee's record.
//
// ⚠️ So the bar is not "did the name change" — it is "did the PERSON change".
// A confirm that fires on all eleven would be dismissed by muscle memory long
// before it met the one that mattered, which is the failure mode of every
// warning nobody reads.
//
// Also intended for spec 395's advisory name-mismatch detector, which needs the
// same normalisation — keep it here rather than growing a second copy.

/**
 * Honorifics that appear at the START of names in this roster, longest FIRST.
 *
 * ⚠️ Order is load-bearing: `นาง` would otherwise swallow the prefix of
 * `นางสาว` and leave a stray `สาว` behind, making two spellings of one person
 * look like two people.
 */
const HONORIFICS = ["นางสาว", "นาง", "นาย", "น.ส.", "น.ส", "ด.ช.", "ด.ญ."] as const;

const HONORIFIC_RE = new RegExp(
  `^(?:${HONORIFICS.map((h) => h.replace(/\./g, "\\.")).join("|")})\\s*`,
);

/**
 * A person's name reduced to the part that identifies the HUMAN: leading
 * honorific removed, all whitespace collapsed away.
 *
 * ⚠️ The honorific is stripped only at the START. A given name that merely
 * contains those syllables (`สมนาย`) must survive intact — truncating it would
 * silently equate two different people, the exact error this module exists to
 * prevent.
 */
export function normaliseThaiPersonName(name: string): string {
  return name.trim().replace(HONORIFIC_RE, "").replace(/\s+/gu, "");
}

/**
 * Is this rename a tidy-up of the same person's name rather than a swap to a
 * different person?
 *
 * `true`  → adding/removing/swapping an honorific, or fixing whitespace. Silent.
 * `false` → anything else, INCLUDING a one-character spelling correction.
 *
 * ⚠️ Deliberately conservative on spelling. `ทีฆายุมธสกุล` → `ทีฆายุทธสกุล` is
 * almost certainly a typo fix, and it still returns `false`. Being wrong in that
 * direction costs one extra press; being wrong the other way costs an employee's
 * record — which is a thing that has actually happened here, once.
 */
export function isNormalisingRename(oldName: string, newName: string): boolean {
  const before = normaliseThaiPersonName(oldName);
  const after = normaliseThaiPersonName(newName);
  // ⚠️ An EMPTY normalisation is not a match, it is an absence of evidence.
  // `นาย` and `นางสาว` both reduce to "" — without this, a placeholder row whose
  // stored name is a bare honorific would rename silently to any other bare
  // honorific. Empty means "I cannot tell", and this function's whole job is to
  // authorise silence, so it must never authorise it on nothing.
  if (before === "" || after === "") return false;
  return before === after;
}
