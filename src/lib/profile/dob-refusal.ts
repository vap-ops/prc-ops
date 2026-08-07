// Spec 403 U1 — Thai copy for a refused birth date.
//
// The gate lives in the database (a trigger on every table holding a DOB), and
// it raises P0001 with an English reason token. Both call sites previously fell
// through to "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง", which is a lie: a DOB
// refusal is PERMANENT — the same date will always fail. The repo already
// carries that rule from the storage-RLS episode.
//
// This returns the FACT only, with no actor and no instruction. Two very
// different audiences read it — the person correcting their own birthday, who
// can fix it, and an approver looking at someone else's stored proposal, who
// cannot — so each caller appends its own next step. A shared string naming one
// of them would be false for the other.
//
// A leaf module with no `server-only` and no DB import, so either side can hold
// it without poisoning a bundle.

/** The floor the database enforces. Operator ruling 2026-08-07. */
export const DOB_MIN_AGE = 15;

// Keyed on the tokens raised by public.dob_rejection_reason. They are
// deliberately distinct and non-overlapping: the callers match by substring, so
// one token containing another would let the wrong arm answer.
const FACTS: ReadonlyArray<readonly [string, string]> = [
  [
    "dob looks like a buddhist era year",
    "ปีเกิดที่กรอกดูเหมือนเป็น พ.ศ. — ระบบใช้ ค.ศ. (นำปี พ.ศ. ลบ 543)",
  ],
  ["dob in the future", "วันเกิดเป็นวันในอนาคต"],
  ["dob under minimum age", `วันเกิดนี้ทำให้อายุไม่ถึง ${DOB_MIN_AGE} ปี`],
  ["dob implausibly old", "ปีเกิดที่กรอกไม่ถูกต้อง"],
  ["dob is not a real date", "วันเกิดที่กรอกไม่ถูกต้อง"],
];

/**
 * The Thai fact behind a DOB refusal, or null when the error is not one — so
 * every other failure keeps the copy it already had.
 */
export function dobRefusalFact(errorMessage: string): string | null {
  for (const [token, fact] of FACTS) {
    if (errorMessage.includes(token)) return fact;
  }
  return null;
}
