// Unit-picker vocabulary (spec 16 §1). TS constant, not a DB table —
// static presentation data; AppSheet reads the stored text, never this
// list. The operator amends it by code PR; the unit test pins the exact
// contents so any change is deliberate.
//
// UNIT_OTHER_VALUE is the <select> sentinel that reveals the free-text
// input (อื่น ๆ (ระบุเอง)). It is UI state only and must never be
// persisted — the form submits the derived unit string instead.

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
