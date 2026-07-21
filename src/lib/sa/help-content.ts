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
    // Spec 313 U7: written against the cockpit's ACTUAL affordances
    // (muster-cockpit.tsx) — a fresh-eyes pass caught an earlier draft of this
    // card describing a flow that does not exist. The order below is the real
    // one: the team must be OPENED before any scan/add button renders; + เพิ่มช่าง
    // and สแกน QR live in เข้า mode only, and check-out is a per-person เช็คออก
    // button that appears after switching to ออก. The camera button renders only
    // where BarcodeDetector exists (Android/PWA), so tapping leads and scanning
    // is named as the shortcut, not the path.
    steps: [
      "เปิดแท็บ “ทีมงาน” แล้วกดปุ่ม เช็คชื่อ (ปุ่มนี้จะขึ้นเมื่อเลือกไซต์ปัจจุบันแล้ว)",
      "ครั้งแรกของวัน: เลือกหัวหน้าทีม แล้วกด เปิดทีม",
      "โหมด เข้า: กด + เพิ่มช่าง แล้วเลือกชื่อ — ถ้าเครื่องสแกนได้ จะมีปุ่ม สแกน QR บัตรช่าง ให้ใช้แทนได้",
      "ตอนเลิกงาน: สลับเป็นโหมด ออก แล้วกด เช็คออก ที่ชื่อช่างแต่ละคน",
      "ระบบบันทึกให้ทันที ไม่ต้องกดบันทึกซ้ำ",
    ],
    // The WAGE path is still separate until spec 306 U5 derives labor from the
    // muster. Named precisely: the /sa แถบ ทีมงานวันนี้ is a SUMMARY with one bulk
    // ทั้งหมดมาทำ button (muster-strip.tsx), while the per-person tap is on
    // แผนวันนี้ (daily-plan-worklist.tsx:96). The old copy claimed the strip could
    // mark มา/ไม่มา per person — it can do neither: the app records PRESENCE only,
    // there is no absent control anywhere in src.
    tip: "เช็คชื่อทุกเช้า ช่วยให้คิดค่าแรงและวางแผนงานได้ถูกต้อง — ส่วนค่าแรง ให้กด ทั้งหมดมาทำ ที่แถบ ทีมงานวันนี้ หน้าหลัก หรือกด มาทำ ทีละคนที่ แผนวันนี้",
  },
  {
    id: "add-crew",
    title: "เพิ่มช่างใหม่",
    whenToUse: "มีช่างใหม่เข้าทีม",
    steps: [
      "ไปที่ “ทีมงาน” แล้วกดปุ่ม “เพิ่มช่างใหม่”",
      "ช่างมีมือถือ: ให้สแกน QR ของโครงการด้วยมือถือตัวเอง แล้วกรอกข้อมูลและบัญชีธนาคารเอง",
      "ช่างไม่มีมือถือ: กรอกชื่อ–เลขบัตรประชาชน–วันเกิด แล้วถ่ายรูปหรือแนบรูปสมุดบัญชี",
      "เสร็จแล้ว ช่างจะขึ้นในรายชื่อทีม รอผู้จัดการยืนยัน",
    ],
    tip: "เรื่องค่าจ้าง/ระดับ และเลขที่บัญชี เป็นหน้าที่ผู้จัดการ (PM) — SA แค่เพิ่มช่างและแนบรูปสมุดบัญชี",
  },
  {
    id: "manage",
    title: "จัดการทีม",
    whenToUse: "ดูสมาชิกทีม และสถานะการรับช่างเข้าทีม",
    steps: [
      // Spec 313 U7: U3 retired the SaTools ทีมงาน tile once /team got its own
      // bottom tab; this step named the retired door.
      "เปิดแท็บ “ทีมงาน” ที่แถบล่าง",
      "ดูสถานะการรับเข้า: รอตรวจ → รอยืนยัน → พร้อม",
      "ดู “ทีมหน้างาน” เพื่อเห็นว่าใครอยู่ทีมไหน",
    ],
    tip: "ช่างใหม่จะขึ้น “รอยืนยัน” จนกว่าผู้จัดการ (PM) จะยืนยันค่าจ้าง/ระดับ — เรื่องเงินเป็นหน้าที่ PM ไม่ใช่ SA",
  },
];
