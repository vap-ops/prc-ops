// Spec 330 U5 — ⓘ role-explainer copy for the team map's three tiers.
// Lives in src/lib/help/ (spec-314 PayModelExplainer precedent): help prose
// stays out of the label SSOT and out of money-logic dirs. Descriptions are
// short, field-first Thai — one line each, no jargon.

export interface TeamMapRoleHelpEntry {
  /** Short Thai role/badge name as it appears on the map. */
  label: string;
  description: string;
}

export const TEAM_MAP_ROLE_HELP: Record<
  "management" | "site" | "crew",
  ReadonlyArray<TeamMapRoleHelpEntry>
> = {
  management: [
    {
      label: "หัวหน้าโครงการ ★",
      description: "ผู้รับผิดชอบโครงการโดยรวม ตัดสินใจและอนุมัติเรื่องสำคัญของโครงการ",
    },
    {
      label: "ผู้จัดการโครงการ",
      description: "บริหารงานประจำวันของโครงการ วางแผนงานและติดตามความคืบหน้า",
    },
    {
      label: "ผู้อำนวยการโครงการ",
      description: "ดูแลภาพรวมหลายโครงการ ให้ทิศทางและตรวจสอบผลงาน",
    },
    {
      label: "ผู้ดูแลระบบ",
      description: "ดูแลระบบและสิทธิ์การใช้งานของทุกคนในบริษัท",
    },
  ],
  site: [
    {
      label: "ผู้ดูแลหน้างาน",
      description: "แอดมินประจำไซต์ บันทึกรูปงาน เช็คชื่อช่าง และจัดทีมทำงานรายวัน",
    },
    {
      label: "SA หลัก ★",
      description: "ผู้ดูแลหน้างานที่รับผิดชอบไซต์นี้เป็นหลัก",
    },
    {
      label: "เจ้าของไซต์",
      description: "ติดตามความคืบหน้าของงานในไซต์ของตนเอง",
    },
    {
      label: "ผู้ตรวจสอบ",
      description: "ดูข้อมูลเพื่อการตรวจสอบ ไม่แก้ไขงาน",
    },
  ],
  crew: [
    {
      label: "หัวหน้าทีม ★",
      description: "หัวหน้าทีมช่าง รับผิดชอบงานของทีมและนำทีมทำงานตามแผน",
    },
    {
      label: "ทีม PRC",
      description: "ทีมช่างของบริษัท จัดเข้าแผนงานรายวันได้ ค่าแรงบันทึกผ่านระบบ",
    },
    {
      label: "ทีมผู้รับเหมา",
      description: "ช่างของผู้รับเหมา ผู้รับเหมาเป็นผู้จ่ายค่าแรงเอง จึงไม่อยู่ในทีมช่างของบริษัท",
    },
    {
      label: "ยังไม่จัดทีม",
      description: "ช่างในโครงการที่ยังไม่ได้อยู่ทีมไหน แตะชื่อเพื่อจัดเข้าทีม",
    },
  ],
};
