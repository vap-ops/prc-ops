// Spec 314 U4 (help) — the pay-model explainer copy as TYPED DATA so copy edits
// never touch layout. Audience = the PM/super_admin on /settings/labor-rates
// (procurement_manager + super_admin). Explains the ADR 0082 model: a firm-wide,
// disinterested standard day-rate per skill level (ADR 0060), the gross-vs-net
// basis, the frozen firm WHT %, that new technicians default to daily, and how
// /payroll shows the gross/WHT/net split. Thai terms track the live labels
// (ก่อนหักภาษี / หลังหักภาษี / ค่าแรงเต็ม / หัก ณ ที่จ่าย / สุทธิ) so the copy never drifts
// from the fields it describes.

export interface PayModelHelpPoint {
  /** The concept being defined (rendered emphasised). */
  term: string;
  /** One or two sentences explaining it in plain Thai. */
  detail: string;
}

export const PAY_MODEL_HELP_TITLE = "เกี่ยวกับค่าแรงมาตรฐานและภาษีหัก ณ ที่จ่าย";

export const PAY_MODEL_HELP_INTRO =
  "อัตราที่ตั้งตรงนี้เป็นค่าแรงมาตรฐานของทั้งบริษัท ใช้กับช่างทุกคนตามระดับฝีมือ — ไม่ใช่การต่อรองรายคน";

export const PAY_MODEL_HELP_POINTS: PayModelHelpPoint[] = [
  {
    term: "อัตราเดียวทั้งบริษัท (เป็นกลาง)",
    detail:
      "ค่าแรงมาตรฐานตั้งต่อ “ระดับฝีมือ” และใช้กับช่างทุกคนในระดับนั้นเท่ากัน ผู้จัดการ (PM) เป็นผู้กำหนด เพื่อให้อัตราเป็นกลาง — คนตั้งอัตราไม่ใช่คนที่ได้รับค่าแรงนั้น",
  },
  {
    term: "ฐานภาษี: ก่อนหักภาษี vs หลังหักภาษี",
    detail:
      "เลือก “ก่อนหักภาษี” เมื่อตัวเลขที่กรอกคือค่าแรงเต็ม (ยังไม่หักภาษี) · เลือก “หลังหักภาษี” เมื่อตัวเลขที่กรอกคือเงินที่ช่างได้รับจริง (สุทธิ) แล้วระบบจะคำนวณกลับเป็นค่าแรงเต็มให้เอง — ดูยอด “ค่าแรงเต็ม” ที่แสดงข้างช่องกรอก",
  },
  {
    term: "ภาษีหัก ณ ที่จ่าย (%)",
    detail:
      "ใช้อัตราเดียวทั้งบริษัท (เริ่มต้น 3%) หักจากค่าแรงและนำส่งแทนช่าง แก้ไขได้ที่ช่องด้านล่าง",
  },
  {
    term: "ช่างใหม่เริ่มต้นเป็น “รายวัน”",
    detail:
      "ช่างที่เพิ่มเข้าใหม่จะตั้งเป็นแบบรายวันโดยอัตโนมัติ ที่อัตรามาตรฐานตามระดับ (ผู้จัดการยืนยันระดับ/ค่าจ้างได้ภายหลัง)",
  },
  {
    term: "หัก ณ ที่จ่าย และยอดสุทธิ",
    detail:
      "ค่าแรงจะถูกหักภาษี ณ ที่จ่ายตามเปอร์เซ็นต์ที่ตั้งไว้ เหลือเป็นยอดสุทธิที่ช่างได้รับจริง (ค่าแรงเต็ม − หัก ณ ที่จ่าย = สุทธิ) หน้า “ค่าแรง” จะแสดงยอดทั้งสามนี้ · เปอร์เซ็นต์ภาษีถูกล็อกไว้ตอนบันทึกงานแต่ละวัน จึงไม่กระทบวันที่บันทึกไปแล้วเมื่อแก้ % ภายหลัง",
  },
];
