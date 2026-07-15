// Spec 312 follow-up 2 — cause-specific copy for a refused rental void.
//
// void_equipment_rental_batch (mig 075799) raises errcode RB409 for three
// distinct causes, each with its own message: a CURRENT (nonzero) settlement is
// still attached, a charge is attached, or the batch is no longer active. The
// server action used to collapse all three into one vague string, so a user who
// hit the settlement block was never told the actual next step — zero the
// settlement first (which the 075799 fix now lets them do). This maps the DB
// message to a signpost that names WHERE to go and WHAT to do.
//
// Matching is on stable fragments of the DB message. The live-settlement path is
// the load-bearing one (it must always point the user at the right step) and is
// pinned END-TO-END: supabase/tests/database/312-equipment-batch-void.test.sql
// asserts the exact `...batch has a live settlement` message the RPC raises, and
// the mapper test below feeds that same string. The charges / non-active
// fragments are best-effort: if a future migration rewords one so it no longer
// matches, the mapper falls through to a STATE-NEUTRAL generic (never a wrong
// concrete state) — so a reword degrades the copy gracefully, it never misleads.

import { RENTAL_SETTLEMENT_HISTORY_LABEL } from "@/lib/i18n/labels";

// A live settlement still carries money — point the user at the settlement
// history (where แก้ไข lives) and tell them to zero it, then re-try the void.
export const VOID_BLOCKED_BY_SETTLEMENT = `ยกเลิกไม่ได้ — รายการนี้มีการปิดยอด/ชำระที่ยังมีมูลค่าอยู่ กรุณาไปที่หัวข้อ “${RENTAL_SETTLEMENT_HISTORY_LABEL}” ด้านล่าง กดแก้ไขยอดเป็น 0 ก่อน แล้วจึงยกเลิกการเช่าได้`;

export const VOID_BLOCKED_BY_CHARGES =
  "ยกเลิกไม่ได้ — รายการนี้มีค่าใช้จ่ายผูกอยู่ กรุณายกเลิกค่าใช้จ่ายที่เกี่ยวข้องก่อน";

export const VOID_NOT_ACTIVE = "ยกเลิกไม่ได้ — รายการนี้ถูกยกเลิกหรือปิดไปแล้ว";

// State-neutral fallback: used when the RB409 message matches none of the known
// causes (a reworded or future cause). Never asserts a concrete state, so it
// can't mislabel — worse to tell the user "already cancelled" than "cannot right
// now".
export const VOID_CANNOT = "ยกเลิกไม่ได้ในขณะนี้ กรุณาตรวจสอบการปิดยอดและค่าใช้จ่ายที่เกี่ยวข้อง";

// The RB409 message → Thai signpost. The three fragments are disjoint (each RPC
// error carries exactly one), so match order is not load-bearing. Anything
// unmatched → the state-neutral generic (never the raw DB text).
export function voidRb409Message(dbMessage: string | undefined): string {
  const m = dbMessage ?? "";
  if (m.includes("live settlement")) return VOID_BLOCKED_BY_SETTLEMENT;
  if (m.includes("has charges")) return VOID_BLOCKED_BY_CHARGES;
  if (m.includes("active")) return VOID_NOT_ACTIVE;
  return VOID_CANNOT;
}
