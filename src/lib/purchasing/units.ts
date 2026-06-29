// Unit-picker vocabulary — HISTORICAL SEED-OF-RECORD (spec 16 §1).
//
// Spec 223 (ADR 0066 / S1) moved the managed picker vocabulary into the
// public.catalog_units table — now the SSOT for the picker options (the
// migration 20260813029000 seeds the table from this exact list). AppSheet was
// sunset (ADR 0034), so the original "TS constant, AppSheet reads the stored
// text" rationale no longer holds. This constant is KEPT as the seed-of-record +
// a test anchor (and the in-code fallback the form uses when no rows are
// threaded). The unit test pins the exact contents so any change is deliberate.
//
// UNIT_OTHER_VALUE is the <select> sentinel that reveals the free-text
// input (อื่น ๆ (ระบุเอง)) — the escape hatch RETAINED by spec 223. It is UI
// state only and must never be persisted — the form submits the typed unit
// string instead.

export const COMMON_UNITS: ReadonlyArray<string> = [
  "ถุง",
  "กระสอบ",
  "ก้อน",
  "แผ่น",
  "เส้น",
  "ท่อน",
  "ม้วน",
  "มัด",
  "กล่อง",
  "ชุด",
  "ตัว",
  "อัน",
  "ชิ้น",
  "ใบ",
  "ถัง",
  "แกลลอน",
  "กระป๋อง",
  "เมตร",
  "ตารางเมตร",
  "ลูกบาศก์เมตร",
  "คิว",
  "กิโลกรัม",
  "ตัน",
  "ลิตร",
  "เที่ยว",
];

export const UNIT_OTHER_VALUE = "__other__";
