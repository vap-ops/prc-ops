// Spec 316 U1 — the operator-facing role/capability SSOT. Derives everything
// derivable from the real gates so it cannot silently rot:
//   - membership: each entry's `roles` IS the imported live constant (never
//     re-typed here) — the bijection guard in
//     tests/unit/role-capabilities.test.ts fails CI when a *_ROLES export in
//     the two swept sources (role-home.ts + billing-actions.ts) lands without
//     a registry entry, or an entry stops mirroring its export. Sets defined
//     in OTHER modules are out of the mechanical sweep and must be added to
//     both the registry and the test's manual list (spec 316 §3);
//   - home + unbuilt status: computed through roleHome().
// Authored-once facts (Thai labels, domains, categories, summaries) are pinned
// by exhaustive Record<UserRole, …> types, so they can age in wording but never
// go missing. Consumed by the /settings/roles guided picker (U2) and the
// /settings/roles/capabilities explorer (U3).

import type { UserRole } from "@/lib/db/enums";
import {
  ACCOUNTING_ROLES,
  BACK_OFFICE_ROLES,
  COMPANY_DOC_VIEW_ROLES,
  CLIENT_ISSUER_ROLES,
  DASHBOARD_VIEW_ROLES,
  DOC_APPROVAL_ROLES,
  EQUIPMENT_MOVE_ROLES,
  EXTERNAL_ROLES,
  LEGAL_ROLES,
  MONEY_VIEW_ROLES,
  OFFICE_EXPENSE_FINANCE_ROLES,
  OFFICE_EXPENSE_ROLES,
  PAYROLL_ROLES,
  PAYROLL_VIEW_ROLES,
  PM_ROLES,
  PO_DETAIL_VIEW_ROLES,
  PROCUREMENT_MANAGER_ROLES,
  PROJECT_TEAM_STAFF_ROLES,
  PROJECT_VIEW_ROLES,
  PR_DECIDER_ROLES,
  PURCHASE_REPORT_ROLES,
  PURCHASING_ROLES,
  RECEIVE_ROLES,
  SCHEDULE_VIEW_ROLES,
  SITE_STAFF_ROLES,
  STAFF_APPROVAL_ROLES,
  STAFF_ONBOARDABLE_ROLES,
  SUPPLY_PLAN_ROLES,
  WORKER_ROSTER_ROLES,
  WP_DETAIL_ROLES,
  roleHome,
} from "@/lib/auth/role-home";
import { BILLING_WRITE_ROLES } from "@/lib/accounting/billing-actions";

export type RoleCategory = "office" | "field" | "external";

export const ROLE_CATEGORY_LABEL: Record<RoleCategory, string> = {
  office: "สำนักงาน",
  field: "หน้างาน",
  external: "บุคคลภายนอก",
};

// Exhaustive: a new user_role enum value is a TYPE error here until placed
// (same deliberate trip as ROLE_GROUP_ORDER — see CLAUDE.md "Roles").
export const ROLE_CATEGORY: Record<UserRole, RoleCategory> = {
  super_admin: "office",
  project_director: "office",
  project_manager: "office",
  project_coordinator: "office",
  procurement: "office",
  procurement_manager: "office",
  accounting: "office",
  legal: "office",
  hr: "office",
  auditor: "office",
  subcon_manager: "office",
  site_admin: "field",
  technician: "field",
  site_owner: "field",
  client: "external",
  contractor: "external",
  visitor: "external",
};

// One line per role for the picker rows + explorer. Authored — wording may
// age, presence cannot (exhaustive Record + nonblank guard).
export const ROLE_SUMMARY: Record<UserRole, string> = {
  super_admin: "เจ้าของระบบ — เห็นและทำได้ทุกอย่าง",
  project_director: "ผู้อำนวยการโครงการ — ระดับผู้จัดการ เห็นทุกโครงการ",
  project_manager: "ผู้จัดการโครงการ — บริหารงาน อนุมัติงานและคำขอซื้อ",
  project_coordinator: "ผู้ประสานงาน — ดูทุกโครงการ (อ่านอย่างเดียว)",
  site_admin: "ทีมหน้างาน — ถ่ายรูป บันทึกงาน/แรงงาน ขอซื้อ",
  procurement: "ฝ่ายจัดซื้อ — ทำคำขอซื้อ→ใบสั่งซื้อ และดูแลช่าง",
  procurement_manager: "หัวหน้าฝ่ายจัดซื้อ — อนุมัติ/ยกเลิกงานจัดซื้อได้",
  technician: "ช่าง — เห็นบัตรประจำตัวและงานของตัวเอง",
  accounting: "ฝ่ายบัญชี — เห็นการเงินทั้งหมด (อ่านอย่างเดียว)",
  legal: "ฝ่ายกฎหมาย — ระบบสัญญาและอนุมัติเอกสาร",
  hr: "ฝ่ายบุคคล — ยังไม่เปิดใช้งาน",
  subcon_manager: "ผู้จัดการผู้รับเหมาช่วง — ยังไม่เปิดใช้งาน",
  site_owner: "หัวหน้าหน้างาน — ยังไม่เปิดใช้งาน",
  auditor: "ผู้ตรวจสอบ — ยังไม่เปิดใช้งาน",
  visitor: "ยังไม่ได้รับสิทธิ์ (ค่าเริ่มต้นหลังสมัคร)",
  contractor: "ผู้รับเหมาภายนอก — ใช้พอร์ทัล DC",
  client: "ลูกค้า — ดูความคืบหน้าโครงการ (อ่านอย่างเดียว)",
};

// Thai screen name per roleHome() route. The guard test walks roleHome() over
// the whole enum, so a new home route cannot land without a label here.
export const HOME_LABEL: Record<string, string> = {
  "/sa": "งานวันนี้ (หน้างาน)",
  "/dashboard": "ภาพรวม",
  "/requests": "คำขอซื้อ",
  // Spec 323 U3b: the procurement tiers' home flipped to the STR hub.
  "/procurement": "จัดซื้อ (ศูนย์รวม)",
  "/projects": "โครงการ",
  "/portal": "พอร์ทัลผู้รับเหมา",
  "/accounting": "บัญชี",
  "/legal": "กฎหมาย",
  "/client": "พอร์ทัลลูกค้า",
  "/technician": "หน้าช่าง",
  "/coming-soon": "ยังไม่มีหน้าจอ",
};

export type CapabilityDomain = "site" | "purchasing" | "team" | "money" | "documents" | "admin";

// Key order here IS the canonical display order (capabilitiesForRole groups
// by it, the U3 explorer renders domain sections in it).
export const CAPABILITY_DOMAIN_LABEL: Record<CapabilityDomain, string> = {
  site: "โครงการ/หน้างาน",
  purchasing: "จัดซื้อ",
  team: "ทีมงาน",
  money: "เงิน/บัญชี",
  documents: "เอกสาร/กฎหมาย",
  admin: "ระบบ/ตั้งค่า",
};

export interface CapabilityEntry {
  /** Stable kebab-case id (test + rolesForCapability lookups). */
  key: string;
  /**
   * The EXPORT NAME of the set this entry mirrors. The guard test asserts a
   * bijection: every swept export name has exactly one entry whose `roles` is
   * the identical object — so an aliased export, a deleted entry, or a
   * hand-typed `roles` array all fail CI (fresh-eyes finding, U1 review).
   */
  setName: string;
  /** THE live constant from its owning module — never a re-typed copy. */
  roles: readonly UserRole[];
  labelTh: string;
  domain: CapabilityDomain;
  /** Classification sets (not user-facing capabilities) — never rendered. */
  hidden?: boolean;
}

export const CAPABILITY_REGISTRY: readonly CapabilityEntry[] = [
  // site
  {
    key: "site-capture",
    setName: "SITE_STAFF_ROLES",
    roles: SITE_STAFF_ROLES,
    labelTh: "บันทึกงานหน้างาน (รูปถ่าย/งาน/แรงงาน)",
    domain: "site",
  },
  {
    key: "wp-detail",
    setName: "WP_DETAIL_ROLES",
    roles: WP_DETAIL_ROLES,
    labelTh: "เปิดดูรายละเอียดชุดงาน (WP)",
    domain: "site",
  },
  {
    key: "projects",
    setName: "PROJECT_VIEW_ROLES",
    roles: PROJECT_VIEW_ROLES,
    labelTh: "เปิดดูโครงการ",
    domain: "site",
  },
  {
    key: "schedule",
    setName: "SCHEDULE_VIEW_ROLES",
    roles: SCHEDULE_VIEW_ROLES,
    labelTh: "ดูตารางงานโครงการ",
    domain: "site",
  },
  {
    key: "equipment",
    setName: "EQUIPMENT_MOVE_ROLES",
    roles: EQUIPMENT_MOVE_ROLES,
    labelTh: "บันทึกการเคลื่อนย้ายเครื่องมือ",
    domain: "site",
  },
  // purchasing
  {
    key: "requests",
    setName: "PURCHASING_ROLES",
    roles: PURCHASING_ROLES,
    labelTh: "ใช้งานหน้าคำขอซื้อ",
    domain: "purchasing",
  },
  {
    key: "pr-decide",
    setName: "PR_DECIDER_ROLES",
    roles: PR_DECIDER_ROLES,
    labelTh: "อนุมัติ/ปฏิเสธคำขอซื้อ",
    domain: "purchasing",
  },
  {
    key: "procurement-void",
    setName: "PROCUREMENT_MANAGER_ROLES",
    roles: PROCUREMENT_MANAGER_ROLES,
    labelTh: "ยกเลิกใบสั่งซื้อ/คำขอซื้อที่อนุมัติแล้ว",
    domain: "purchasing",
  },
  {
    key: "receive",
    setName: "RECEIVE_ROLES",
    roles: RECEIVE_ROLES,
    labelTh: "รับของตามใบสั่งซื้อ",
    domain: "purchasing",
  },
  {
    key: "back-office",
    setName: "BACK_OFFICE_ROLES",
    roles: BACK_OFFICE_ROLES,
    labelTh: "งานหลังบ้าน — จัดการผู้ขาย/เอกสารจัดซื้อ",
    domain: "purchasing",
  },
  {
    key: "supply-plan",
    setName: "SUPPLY_PLAN_ROLES",
    roles: SUPPLY_PLAN_ROLES,
    labelTh: "วางแผนจัดซื้อวัสดุ",
    domain: "purchasing",
  },
  {
    key: "po-detail",
    setName: "PO_DETAIL_VIEW_ROLES",
    roles: PO_DETAIL_VIEW_ROLES,
    labelTh: "เปิดดูรายละเอียดใบสั่งซื้อ",
    domain: "purchasing",
  },
  {
    key: "purchase-report",
    setName: "PURCHASE_REPORT_ROLES",
    roles: PURCHASE_REPORT_ROLES,
    labelTh: "ดูรายงานจัดซื้อ + ส่งออก CSV",
    domain: "purchasing",
  },
  // team
  {
    key: "worker-roster",
    setName: "WORKER_ROSTER_ROLES",
    roles: WORKER_ROSTER_ROLES,
    labelTh: "จัดการรายชื่อช่าง + เพิ่มช่างใหม่",
    domain: "team",
  },
  {
    // Spec 330: classification set — the roles a PM can ADD to a project team
    // (membership drives can_see_project for PM/SA/site_owner/auditor). Not a
    // capability of the listed roles themselves, so never rendered.
    key: "project-team-addable",
    setName: "PROJECT_TEAM_STAFF_ROLES",
    roles: PROJECT_TEAM_STAFF_ROLES,
    labelTh: "เพิ่มเข้าทีมโครงการได้ (รายการสิทธิ์ที่เลือกได้)",
    domain: "team",
    hidden: true,
  },
  {
    key: "staff-approve",
    setName: "STAFF_APPROVAL_ROLES",
    roles: STAFF_APPROVAL_ROLES,
    labelTh: "อนุมัติผู้สมัคร + กำหนดสิทธิ์เริ่มต้น",
    domain: "team",
  },
  {
    key: "staff-onboardable",
    setName: "STAFF_ONBOARDABLE_ROLES",
    roles: STAFF_ONBOARDABLE_ROLES,
    labelTh: "สมัครผ่านระบบได้ (รายการสิทธิ์ที่เปิดรับสมัคร)",
    domain: "team",
    hidden: true,
  },
  // money
  {
    key: "payroll",
    setName: "PAYROLL_ROLES",
    roles: PAYROLL_ROLES,
    labelTh: "ดูและจ่ายค่าแรง",
    domain: "money",
  },
  {
    key: "payroll-view",
    setName: "PAYROLL_VIEW_ROLES",
    roles: PAYROLL_VIEW_ROLES,
    labelTh: "ดูค่าแรง (อ่านอย่างเดียว)",
    domain: "money",
  },
  {
    key: "dashboard",
    setName: "DASHBOARD_VIEW_ROLES",
    roles: DASHBOARD_VIEW_ROLES,
    labelTh: "ดูภาพรวมโครงการ (แดชบอร์ด)",
    domain: "money",
  },
  {
    key: "money-view",
    setName: "MONEY_VIEW_ROLES",
    roles: MONEY_VIEW_ROLES,
    labelTh: "ดูตัวเลขการเงินโครงการ",
    domain: "money",
  },
  {
    key: "accounting",
    setName: "ACCOUNTING_ROLES",
    roles: ACCOUNTING_ROLES,
    labelTh: "ใช้งานหน้าบัญชี (งบทดลอง/กระทบยอด)",
    domain: "money",
  },
  // Spec 329: read/download/share the firm's document library (เอกสารบริษัท).
  {
    key: "company-doc-view",
    setName: "COMPANY_DOC_VIEW_ROLES",
    roles: COMPANY_DOC_VIEW_ROLES,
    labelTh: "ดู/ดาวน์โหลดเอกสารบริษัท",
    domain: "documents",
  },
  {
    key: "office-expense",
    setName: "OFFICE_EXPENSE_ROLES",
    roles: OFFICE_EXPENSE_ROLES,
    labelTh: "บันทึกค่าใช้จ่ายสำนักงาน",
    domain: "money",
  },
  {
    key: "office-expense-finance",
    setName: "OFFICE_EXPENSE_FINANCE_ROLES",
    roles: OFFICE_EXPENSE_FINANCE_ROLES,
    labelTh: "เห็นค่าใช้จ่ายสำนักงานทั้งหมด + ทำเบิกคืน",
    domain: "money",
  },
  {
    key: "billing",
    setName: "BILLING_WRITE_ROLES",
    roles: BILLING_WRITE_ROLES,
    labelTh: "ออก/แก้ไขใบแจ้งหนี้ลูกค้า",
    domain: "money",
  },
  // documents
  {
    key: "legal",
    setName: "LEGAL_ROLES",
    roles: LEGAL_ROLES,
    labelTh: "ใช้งานระบบสัญญา (ฝ่ายกฎหมาย)",
    domain: "documents",
  },
  {
    key: "doc-approval",
    setName: "DOC_APPROVAL_ROLES",
    roles: DOC_APPROVAL_ROLES,
    labelTh: "อนุมัติเอกสาร/สัญญา",
    domain: "documents",
  },
  // admin
  {
    key: "manager-tier",
    setName: "PM_ROLES",
    roles: PM_ROLES,
    labelTh: "ระดับผู้จัดการโครงการ (กลุ่มสิทธิ์หลัก)",
    domain: "admin",
  },
  {
    key: "client-issue",
    setName: "CLIENT_ISSUER_ROLES",
    roles: CLIENT_ISSUER_ROLES,
    labelTh: "ออก/ยกเลิกลิงก์เข้าระบบของลูกค้า",
    domain: "admin",
  },
  {
    key: "external",
    setName: "EXTERNAL_ROLES",
    roles: EXTERNAL_ROLES,
    labelTh: "บุคคลภายนอก (ไม่ใช่พนักงาน)",
    domain: "admin",
    hidden: true,
  },
];

const DOMAIN_ORDER = Object.keys(CAPABILITY_DOMAIN_LABEL) as CapabilityDomain[];

/** Visible capabilities a role holds, grouped in canonical domain order. */
export function capabilitiesForRole(role: UserRole): CapabilityEntry[] {
  return CAPABILITY_REGISTRY.filter((e) => !e.hidden && e.roles.includes(role)).sort(
    (a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain),
  );
}

/** Live membership of one capability; unknown key → empty. */
export function rolesForCapability(key: string): readonly UserRole[] {
  return CAPABILITY_REGISTRY.find((e) => e.key === key)?.roles ?? [];
}

/** Derived, never a hand list: a role with no built home is "unbuilt". */
export function isUnbuiltRole(role: UserRole): boolean {
  return roleHome(role) === "/coming-soon";
}
