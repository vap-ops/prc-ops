// Spec 299 U1 — the /sa/help hub content as TYPED DATA so copy edits never touch layout.
// Cards are ordered by daily-use frequency (photos first — the SA's #1 real activity,
// per sa-real-usage-photos-2026-07), NOT by onboarding sequence. Copy tracks the live
// app terms (ui-term-consistency). The "add-crew" card is spec 299 U2 — it documents
// spec 298's onboarding front door and lands after that shipped.

export interface HelpCard {
  /** Stable anchor id for a future per-screen "?" deep-link (/sa/help#<id>). */
  id: string;
  title: string;
  /** One line: when the SA reaches for this task. */
  whenToUse: string;
  steps: string[];
  /** Optional closing note (e.g. a money-governance reminder). */
  tip?: string;
}

export const HELP_CARDS: HelpCard[] = [
  {
    id: "photos",
    title: "ถ่ายรูปงาน",
    whenToUse: "ทุกครั้งที่งานมีความคืบหน้า หรือทำงานเสร็จ",
    steps: [
      "ที่หน้าหลัก กดปุ่มกล้อง (ถ่ายรูป) มุมล่างขวา",
      "เลือกงานย่อยที่กำลังทำ",
      "ถ่ายรูป หรือเลือกรูปจากเครื่อง",
      "ยืนยัน — รูปจะผูกกับงานนั้นให้ทีมเห็นความคืบหน้า",
    ],
    tip: "ถ่ายให้เห็นงานชัด ๆ ยิ่งถ่ายบ่อย ทีมยิ่งเห็นงานเดินหน้า",
  },
  {
    id: "muster",
    title: "เช็คชื่อทีมงาน",
    whenToUse: "ต้นวัน เพื่อบันทึกว่าวันนี้ใครมาทำงาน",
    steps: [
      "ที่หน้าหลัก ดูแถบ “ทีมงานวันนี้”",
      "ทำเครื่องหมาย มา / ไม่มา ให้ช่างแต่ละคน",
      "ระบบบันทึกให้ทันที ไม่ต้องกดบันทึกซ้ำ",
    ],
    tip: "เช็คชื่อทุกเช้า ช่วยให้คิดค่าแรงและวางแผนงานได้ถูกต้อง",
  },
  {
    id: "add-crew",
    title: "เพิ่มช่างใหม่",
    whenToUse: "มีช่างใหม่เข้าทีม",
    steps: [
      "ไปที่ “ทีมงาน” แล้วกดปุ่ม “เพิ่มช่างใหม่”",
      "ช่างมีมือถือ: ให้สแกน QR ของโครงการด้วยมือถือตัวเอง แล้วกรอกข้อมูลและบัญชีธนาคารเอง",
      "ช่างไม่มีมือถือ: กรอกชื่อ–เลขบัตรประชาชน–วันเกิด แล้วถ่ายรูปสมุดบัญชี",
      "เสร็จแล้ว ช่างจะขึ้นในรายชื่อทีม รอผู้จัดการยืนยัน",
    ],
    tip: "เรื่องค่าจ้าง/ระดับ และเลขที่บัญชี เป็นหน้าที่ผู้จัดการ (PM) — SA แค่เพิ่มช่างและถ่ายรูปสมุดบัญชี",
  },
  {
    id: "manage",
    title: "จัดการทีม",
    whenToUse: "ดูสมาชิกทีม และสถานะการรับช่างเข้าทีม",
    steps: [
      "เปิด “ทีมงาน” จากเมนูเครื่องมือในหน้าหลัก",
      "ดูสถานะการรับเข้า: รอตรวจ → รอยืนยัน → พร้อม",
      "ดู “ทีมหน้างาน” เพื่อเห็นว่าใครอยู่ทีมไหน",
    ],
    tip: "ช่างใหม่จะขึ้น “รอยืนยัน” จนกว่าผู้จัดการ (PM) จะยืนยันค่าจ้าง/ระดับ — เรื่องเงินเป็นหน้าที่ PM ไม่ใช่ SA",
  },
];
