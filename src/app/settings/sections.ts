import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Banknote,
  Calculator,
  ClipboardList,
  CreditCard,
  Eye,
  Files,
  Coins,
  Hammer,
  HardHat,
  HeartPulse,
  Inbox,
  MessageSquarePlus,
  Network,
  Package,
  Receipt,
  ShieldCheck,
  Sparkles,
  Store,
  TriangleAlert,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import {
  ACCOUNTING_ROLES,
  isManagerRole,
  OFFICE_EXPENSE_ROLES,
  type UserRole,
} from "@/lib/auth/role-home";
import {
  CARD_REGISTRY_HINT,
  CARD_REGISTRY_LABEL,
  CATALOG_LABEL,
  EQUIPMENT_RENTAL_LABEL,
  LABOR_RATES_HINT,
  LABOR_RATES_LABEL,
  OFFICE_EXPENSE_HINT,
  OFFICE_EXPENSE_NAV_LABEL,
  ORDERING_TEMPLATES_LABEL,
  SUBCONTRACTOR_LABEL,
  WORKER_TEAM_LABEL,
} from "@/lib/i18n/labels";

// The /settings hub's section/entry SSOT — which doors exist, under which
// heading, visible to whom. Pure data (no JSX) so the role→entries matrix is
// unit-testable without rendering the async server page. The page renders each
// section as ONE grouped card via SettingsSectionCard (section-card.tsx).
// Effective visibility = section gate AND entry gate (visibleEntries below).

export type SettingsEntry =
  | {
      kind: "link";
      href: string;
      icon: LucideIcon;
      label: string;
      hint: string;
      visible?: (role: UserRole) => boolean;
    }
  | {
      // Spec 98: a greyed preview of a not-yet-built menu.
      kind: "coming-soon";
      key: string;
      icon: LucideIcon;
      label: string;
      hint: string;
      visible?: (role: UserRole) => boolean;
    };

export type SettingsSection = {
  key: string;
  title: string;
  visible?: (role: UserRole) => boolean;
  entries: SettingsEntry[];
};

export function visibleEntries(section: SettingsSection, role: UserRole): SettingsEntry[] {
  if (section.visible && !section.visible(role)) return [];
  return section.entries.filter((e) => !e.visible || e.visible(role));
}

// Spec 261 / ADR 0070: procurement_manager is a superset of procurement, so it
// sees the same back-office settings cards (visibility only; enforcement is RLS).
const isBackOffice = (role: UserRole) =>
  isManagerRole(role) || role === "procurement" || role === "procurement_manager";

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // Field tools — site_admin (spec 141 U5). The field can view + move equipment
  // but not curate the registry; back-office roles reach อุปกรณ์ from ข้อมูลหลัก
  // below with the registry framing. (Spec 197 U2: ตรวจนับ left settings — it's
  // reached through a project's คลัง chip.)
  {
    key: "field",
    title: "หน้างาน",
    visible: (role) => role === "site_admin",
    entries: [
      {
        kind: "link",
        href: "/equipment",
        icon: Wrench,
        label: "อุปกรณ์",
        hint: "ดูและย้ายอุปกรณ์หน้างาน",
      },
    ],
  },

  // Master data — the back-office registries. PM tier (spec 99/168/175/245) and
  // procurement (spec 172 Phase B+C / 187) share every door except ลูกค้า, which
  // stays a manager concern. (Spec 197 U1: the store (คลัง) left settings for the
  // per-project sub-route.)
  {
    key: "master-data",
    title: "ข้อมูลหลัก",
    visible: isBackOffice,
    entries: [
      {
        kind: "link",
        href: "/contacts/customers",
        icon: Users,
        label: "ลูกค้า",
        hint: "เจ้าของโครงการ",
        visible: isManagerRole,
      },
      {
        kind: "link",
        href: "/contacts/vendors",
        icon: Store,
        label: "ผู้ขาย/ผู้ให้บริการ",
        hint: "ผู้ขายวัสดุ · ผู้ให้บริการ",
      },
      // Spec 168: ผู้รับเหมาช่วง is its own door — a firm that hires its own crew,
      // separate from the ทีมช่าง (ช่าง) section (spec 266 / ADR 0073).
      {
        kind: "link",
        href: "/contacts/subcontractors",
        icon: Hammer,
        label: SUBCONTRACTOR_LABEL,
        hint: "บริษัทที่จ้างช่วง (จ่ายลูกทีมเอง)",
      },
      {
        kind: "link",
        href: "/equipment",
        icon: Wrench,
        label: "อุปกรณ์",
        hint: "ทะเบียนอุปกรณ์เช่า",
      },
      // Spec 268: record inbound rental deals (money — the /equipment/rentals
      // page re-gates to BACK_OFFICE_ROLES; this card is visibility only).
      {
        kind: "link",
        href: "/equipment/rentals",
        icon: Banknote,
        label: EQUIPMENT_RENTAL_LABEL,
        hint: "บันทึกการเช่า ตลอดโครงการ/รายวัน · ผูกโครงการ",
      },
      // Spec 175: the item catalog (the store's item master).
      {
        kind: "link",
        href: "/catalog",
        icon: Package,
        label: CATALOG_LABEL,
        hint: "รายการวัสดุมาตรฐานสำหรับจัดซื้อ",
      },
      // Spec 245 U4: the ordering-plan templates (TFM 16m/20m) — the supply-plan
      // write tier edits them here; projects clone them on the plan page.
      {
        kind: "link",
        href: "/settings/ordering-templates",
        icon: ClipboardList,
        label: ORDERING_TEMPLATES_LABEL,
        hint: "แม่แบบรายการวัสดุ TFM 16m / 20m",
      },
    ],
  },

  // Team — ทีมช่าง (spec 266 / ADR 0073). The ช่าง roster + ค่าแรง, grouped out of
  // ข้อมูลหลัก and การเงิน into their own section. Same back-office audience
  // (isBackOffice); subcontractors (ผู้รับเหมาช่วง) stay under master-data.
  {
    key: "labor-team",
    title: WORKER_TEAM_LABEL,
    visible: isBackOffice,
    entries: [
      {
        kind: "link",
        href: "/workers",
        icon: HardHat,
        label: "รายชื่อช่าง",
        hint: "ทะเบียนช่าง · การจ่าย/สถานะ · ค่าแรง",
      },
      {
        kind: "link",
        href: "/payroll",
        icon: Wallet,
        label: "ค่าแรง",
        hint: "สรุปค่าแรงรายวัน · ส่งออก CSV",
      },
      // Spec 314 / ADR 0082: the firm-wide standard day-rate per skill level + WHT.
      // Money-set (writes to worker_level_rates / labor_wht_config via DEFINER RPCs)
      // — gated NARROWER than the section: procurement_manager + super_admin only,
      // matching the RPCs' exact gate. project_manager/procurement keep roster+payroll.
      {
        kind: "link",
        href: "/settings/labor-rates",
        icon: Coins,
        label: LABOR_RATES_LABEL,
        hint: LABOR_RATES_HINT,
        visible: (role) => role === "procurement_manager" || role === "super_admin",
      },
    ],
  },

  // Finance. Same section gate as master-data — deliberately NOT widened to the
  // accounting role: its บัญชี door is nested behind the manager/procurement
  // section exactly as the pre-refactor JSX nested it (spec 166 beta posture).
  {
    key: "finance",
    title: "การเงิน",
    visible: isBackOffice,
    entries: [
      // Spec 166: บัญชี (GL) hidden from PM/director during beta — its numbers
      // are provisional until the accountant config lands. ACCOUNTING_ROLES only.
      {
        kind: "link",
        href: "/accounting",
        icon: Calculator,
        label: "บัญชี",
        hint: "งบทดลอง · กำไร–ขาดทุน · กระทบยอด",
        visible: (role) => ACCOUNTING_ROLES.includes(role),
      },
      // Spec 162: Nova's home is การเงิน. Operator-only for v1 (coins are
      // super_admin-read + externals-invisible, ADR 0060 §4).
      {
        kind: "link",
        href: "/nova",
        icon: Sparkles,
        label: "Nova",
        hint: "เหรียญรางวัลทีมงาน · มอบเหรียญ",
        visible: (role) => role === "super_admin",
      },
    ],
  },

  // Spec 310: non-WP office expenses. Its own section (not nested under การเงิน,
  // which excludes accounting) so every OFFICE_EXPENSE_ROLES member — including
  // accounting — reaches it via ตั้งค่า.
  {
    key: "office-expenses",
    title: "ค่าใช้จ่าย",
    visible: (role) => OFFICE_EXPENSE_ROLES.includes(role),
    entries: [
      {
        kind: "link",
        href: "/expenses",
        icon: Receipt,
        label: OFFICE_EXPENSE_NAV_LABEL,
        hint: OFFICE_EXPENSE_HINT,
      },
    ],
  },

  // Help / feedback — everyone (spec 193). The page injects awareness badges
  // (unread replies / open triage counts) by href.
  {
    key: "help",
    title: "ความช่วยเหลือ",
    entries: [
      {
        kind: "link",
        href: "/feedback",
        icon: MessageSquarePlus,
        label: "แจ้งปัญหา / ขอฟีเจอร์",
        hint: "พบข้อผิดพลาด หรืออยากให้ระบบทำอะไรได้เพิ่ม",
      },
      // Spec 193 U3: the operator's triage backlog. super_admin only (RLS reads all).
      {
        kind: "link",
        href: "/feedback/review",
        icon: Inbox,
        label: "รายการที่แจ้งเข้ามา",
        hint: "ดูและจัดการคำขอ/ปัญหาที่ผู้ใช้แจ้ง",
        visible: (role) => role === "super_admin",
      },
    ],
  },

  // Coming soon — everyone (spec 98). "Nova" preview stays for roles that don't
  // have the live /nova link (spec 162); คลังเอกสาร is a future document library.
  {
    key: "coming-soon",
    title: "เร็วๆนี้",
    entries: [
      {
        kind: "coming-soon",
        key: "nova",
        icon: Sparkles,
        label: "Nova",
        hint: "เรียนรู้ เติบโต เลเวลอัพ",
        visible: (role) => role !== "super_admin",
      },
      {
        kind: "coming-soon",
        key: "docs",
        icon: Files,
        label: "คลังเอกสาร",
        hint: "รวมเอกสารทั้งหมดไว้ในที่เดียว",
      },
    ],
  },

  // Admin — super_admin only (spec 220 / ADR 0050 in-app role assignment;
  // spec 244 usage + friction surfaces).
  {
    key: "admin",
    title: "ผู้ดูแลระบบ",
    visible: (role) => role === "super_admin",
    entries: [
      {
        // Spec 283: System Integrity Console — scheduled invariant board.
        kind: "link",
        href: "/settings/integrity",
        icon: HeartPulse,
        label: "ตรวจระบบ",
        hint: "สถานะความถูกต้องของระบบ (บัญชี/สิทธิ์/ข้อมูล) — ตรวจอัตโนมัติทุกชั่วโมง",
      },
      {
        // Spec 310: company-card registry — who holds which card (drives expense reimbursement).
        kind: "link",
        href: "/settings/cards",
        icon: CreditCard,
        label: CARD_REGISTRY_LABEL,
        hint: CARD_REGISTRY_HINT,
      },
      {
        kind: "link",
        href: "/settings/roles",
        icon: ShieldCheck,
        label: "จัดการสิทธิ์ผู้ใช้",
        hint: "กำหนด/เปลี่ยน role ของผู้ใช้ในระบบ",
      },
      {
        // Spec 284 / ADR 0080: the org chart — departments (U0) → head → members.
        kind: "link",
        href: "/settings/org-chart",
        icon: Network,
        label: "โครงสร้างองค์กร",
        hint: "แผนก · หัวหน้าแผนก · สมาชิก (อ่านอย่างเดียว)",
      },
      {
        // Spec 274: view the app as any role (see what they see) without impersonating a person.
        kind: "link",
        href: "/settings/view-as",
        icon: Eye,
        label: "ดูมุมมองตาม role",
        hint: "เปิดแอปเสมือนเป็น role อื่น เพื่อดูเมนู หน้าหลัก และหน้าต่าง ๆ ที่เขาเห็น",
      },
      {
        kind: "link",
        href: "/settings/usage",
        icon: Activity,
        label: "การใช้งานแอป",
        hint: "ดูว่าผู้ใช้แต่ละ role ใช้แอปมากน้อยแค่ไหน เพื่อช่วยเหลือคนที่อาจติดขัด",
      },
      {
        kind: "link",
        href: "/settings/friction-map",
        icon: TriangleAlert,
        label: "จุดสะดุดรายจอ",
        hint: "จอไหนที่ผู้ใช้เจอปัญหามากที่สุด เพื่อจัดลำดับการปรับ UX",
      },
    ],
  },
];
