// Spec 294: sandbox demo dataset — pure data, no DB access.
//
// The applier (scripts/seed-sandbox.ts) turns these into rows on the SANDBOX
// Supabase project only. Everything here is synthetic; no real person, wage,
// or project figure may be added. Category codes must exist in the
// migration-seeded work_categories taxonomy (W01..W99xx hierarchy).

export type SeedPersona = {
  key: string;
  email: string;
  fullName: string;
  role:
    | "super_admin"
    | "site_admin"
    | "project_manager"
    | "project_director"
    | "project_coordinator"
    | "procurement"
    | "procurement_manager"
    | "accounting"
    | "hr"
    | "technician"
    | "legal"
    | "subcon_manager";
};

// One login per role a designer/tester needs to experience. Emails are
// deliberately non-routable (.test TLD) — login happens via minted magiclinks,
// never real mail.
export const SEED_PERSONAS: SeedPersona[] = [
  {
    key: "admin",
    email: "sandbox-admin@prc-ops.test",
    fullName: "ผู้ดูแลระบบ (แซนด์บ็อกซ์)",
    role: "super_admin",
  },
  {
    key: "sa1",
    email: "sandbox-sa1@prc-ops.test",
    fullName: "สมชาย หน้างานหนึ่ง",
    role: "site_admin",
  },
  {
    key: "sa2",
    email: "sandbox-sa2@prc-ops.test",
    fullName: "สมหญิง หน้างานสอง",
    role: "site_admin",
  },
  {
    key: "pm",
    email: "sandbox-pm@prc-ops.test",
    fullName: "ประวิทย์ ผู้จัดการโครงการ",
    role: "project_manager",
  },
  {
    key: "director",
    email: "sandbox-director@prc-ops.test",
    fullName: "ดำรง ผู้อำนวยการ",
    role: "project_director",
  },
  {
    key: "coordinator",
    email: "sandbox-coordinator@prc-ops.test",
    fullName: "กานดา ผู้ประสานงาน",
    role: "project_coordinator",
  },
  {
    key: "proc",
    email: "sandbox-proc@prc-ops.test",
    fullName: "จัดซื้อ ทดสอบ",
    role: "procurement",
  },
  {
    key: "procmgr",
    email: "sandbox-procmgr@prc-ops.test",
    fullName: "หัวหน้าจัดซื้อ ทดสอบ",
    role: "procurement_manager",
  },
  { key: "acct", email: "sandbox-acct@prc-ops.test", fullName: "บัญชี ทดสอบ", role: "accounting" },
  { key: "hr", email: "sandbox-hr@prc-ops.test", fullName: "บุคคล ทดสอบ", role: "hr" },
  {
    key: "tech",
    email: "sandbox-tech@prc-ops.test",
    fullName: "ช่างเทคนิค ทดสอบ",
    role: "technician",
  },
  { key: "legal", email: "sandbox-legal@prc-ops.test", fullName: "นิติกร ทดสอบ", role: "legal" },
];

export type SeedProject = { code: string; name: string };

// Same codes as supabase/seed.sql so the applier upserts instead of duplicating.
export const SEED_PROJECTS: SeedProject[] = [
  { code: "PRC-2026-001", name: "TFG Lam Sonthi" },
  { code: "PRC-2026-002", name: "TFG Kham Muang" },
];

export type SeedWorkPackage = {
  projectCode: string;
  code: string;
  name: string;
  categoryCode: string;
  status: "not_started" | "in_progress" | "pending_approval" | "rework" | "complete" | "on_hold";
  priority: "normal" | "urgent" | "critical";
  deliverableCode?: string; // v1.1: binds the WP to a seeded deliverable
};

// Status spread mirrors a live site: mostly in_progress/not_started with a
// tail of review/rework/complete so every worklist lens has content.
const WP_TEMPLATE: Array<Omit<SeedWorkPackage, "projectCode" | "code"> & { n: number }> = [
  {
    n: 1,
    name: "เคลียร์พื้นที่และรื้อถอนอาคารเดิม",
    categoryCode: "W0105",
    status: "complete",
    priority: "normal",
    deliverableCode: "D01",
  },
  {
    n: 2,
    name: "ปิดล้อมพื้นที่ชั่วคราว",
    categoryCode: "W0102",
    status: "complete",
    priority: "normal",
    deliverableCode: "D01",
  },
  {
    n: 3,
    name: "เสาเข็มตอกโซน A",
    categoryCode: "W0201",
    status: "complete",
    priority: "urgent",
    deliverableCode: "D02",
  },
  {
    n: 4,
    name: "ฐานรากโซน A",
    categoryCode: "W0202",
    status: "in_progress",
    priority: "urgent",
    deliverableCode: "D03",
  },
  {
    n: 5,
    name: "ตอม่อและเสาชั้น 1",
    categoryCode: "W0203",
    status: "in_progress",
    priority: "critical",
    deliverableCode: "D04",
  },
  {
    n: 6,
    name: "เสาเข็มตอกโซน B",
    categoryCode: "W0201",
    status: "in_progress",
    priority: "normal",
    deliverableCode: "D02",
  },
  {
    n: 7,
    name: "ฐานรากโซน B",
    categoryCode: "W0202",
    status: "pending_approval",
    priority: "normal",
    deliverableCode: "D03",
  },
  {
    n: 8,
    name: "งานทำความสะอาดประจำสัปดาห์",
    categoryCode: "W0101",
    status: "in_progress",
    priority: "normal",
  },
  { n: 9, name: "ขออนุญาตไฟฟ้าถาวร", categoryCode: "W0103", status: "on_hold", priority: "normal" },
  {
    n: 10,
    name: "เตรียมงานเฟส 2",
    categoryCode: "W0104",
    status: "not_started",
    priority: "normal",
  },
  {
    n: 11,
    name: "ฐานรากโซน C",
    categoryCode: "W0202",
    status: "not_started",
    priority: "normal",
    deliverableCode: "D03",
  },
  {
    n: 12,
    name: "ตอม่อและเสาชั้น 2",
    categoryCode: "W0203",
    status: "rework",
    priority: "urgent",
    deliverableCode: "D04",
  },
];

export function buildWorkPackages(): SeedWorkPackage[] {
  return SEED_PROJECTS.flatMap((project, pi) =>
    WP_TEMPLATE.map((t) => ({
      projectCode: project.code,
      code: `SBX-${pi + 1}${String(t.n).padStart(2, "0")}`,
      name: t.name,
      categoryCode: t.categoryCode,
      status: t.status,
      priority: t.priority,
      ...(t.deliverableCode ? { deliverableCode: t.deliverableCode } : {}),
    })),
  );
}

export type SeedWorker = {
  name: string;
  dayRate: number;
  payType: "daily" | "monthly";
};

export const SEED_WORKERS: SeedWorker[] = [
  { name: "วิชัย แรงดี", dayRate: 400, payType: "daily" },
  { name: "สมปอง มือหนึ่ง", dayRate: 450, payType: "daily" },
  { name: "บุญมี ขยัน", dayRate: 380, payType: "daily" },
  { name: "แสงเดือน ตรงเวลา", dayRate: 380, payType: "daily" },
  { name: "อาทิตย์ ช่างปูน", dayRate: 500, payType: "daily" },
  { name: "จันทร์เพ็ญ ช่างเหล็ก", dayRate: 480, payType: "daily" },
  { name: "ประสิทธิ์ หัวหน้าชุด", dayRate: 15000, payType: "monthly" },
  { name: "มานะ ช่างไม้", dayRate: 420, payType: "daily" },
];

export type SeedSiteIssue = {
  projectCode: string;
  issueType: "safety" | "weather" | "access" | "equipment" | "other";
  note: string;
};

export const SEED_SITE_ISSUES: SeedSiteIssue[] = [
  {
    projectCode: "PRC-2026-001",
    issueType: "weather",
    note: "ฝนตกหนักช่วงบ่าย งานเทคอนกรีตหยุดชั่วคราว",
  },
  { projectCode: "PRC-2026-001", issueType: "safety", note: "พบนั่งร้านหลวมโซน A แก้ไขแล้ว" },
  {
    projectCode: "PRC-2026-001",
    issueType: "equipment",
    note: "รถเครนเสีย รอช่างซ่อมจากผู้ให้เช่า",
  },
  { projectCode: "PRC-2026-002", issueType: "access", note: "ถนนทางเข้าไซต์ลื่น รถส่งของเข้าช้า" },
  {
    projectCode: "PRC-2026-002",
    issueType: "other",
    note: "เจ้าของพื้นที่ขอเข้าเยี่ยมชมหน้างานพรุ่งนี้",
  },
];

export type SeedLaborRow = {
  projectCode: string;
  wpCode: string;
  workerIndex: number;
  workDate: string; // yyyy-mm-dd
  dayFraction: "full" | "half"; // live labor rows require day_fraction (enum, tombstone check)
};

// Rotates the daily crew across the active WPs for the 10 working days before
// baseDate — enough rows for muster/labor views without pretending payroll.
export function buildLaborPlan(baseDate: Date): SeedLaborRow[] {
  const activeWps = buildWorkPackages().filter((w) => w.status === "in_progress");
  const rows: SeedLaborRow[] = [];
  for (let day = 1; day <= 10; day++) {
    const d = new Date(baseDate.getTime() - day * 86_400_000);
    const workDate = d.toISOString().slice(0, 10);
    for (let wi = 0; wi < SEED_WORKERS.length; wi++) {
      // pay model: monthly staff are payroll, never daily labor_logs
      if (SEED_WORKERS[wi]?.payType !== "daily") continue;
      if ((wi + day) % 3 === 0) continue; // day off — keep the grid uneven
      const wp = activeWps[(wi + day) % activeWps.length];
      if (!wp) continue; // unreachable: modulo of a non-empty list
      rows.push({
        projectCode: wp.projectCode,
        wpCode: wp.code,
        workerIndex: wi,
        workDate,
        dayFraction: (wi + day) % 5 === 0 ? "half" : "full",
      });
    }
  }
  return rows;
}

export type SeedPhoto = {
  projectCode: string;
  wpCode: string;
  phase: "before" | "during" | "after" | "defect" | "after_fix";
  colorHex: string;
  label: string;
};

// One synthetic solid-colour photo per (WP, phase) pair — the applier renders
// these as small PNGs so galleries and WP detail pages are never empty.
export function buildPhotoPlan(): SeedPhoto[] {
  const palette = ["#4f7db3", "#5f9e6e", "#b3764f", "#8e6fae", "#b34f6b", "#4fa3a3"];
  const phases: SeedPhoto["phase"][] = ["before", "during", "after"];
  const wps = buildWorkPackages().filter((w) => w.status !== "not_started");
  const photos: SeedPhoto[] = [];
  let i = 0;
  for (const wp of wps) {
    for (const phase of phases) {
      if ((i + phases.indexOf(phase)) % 2 === 0) {
        photos.push({
          projectCode: wp.projectCode,
          wpCode: wp.code,
          phase,
          colorHex: palette[i % palette.length] ?? "#4f7db3",
          label: `${wp.code} ${phase}`,
        });
      }
    }
    i++;
  }
  return photos;
}

// ——— v1.1 (spec 294 U3) ———

export type SeedDeliverable = {
  projectCode: string;
  code: string;
  name: string;
  sortOrder: number;
};

// Per-project deliverable groups the WP template's deliverableCode binds to.
const DELIVERABLE_TEMPLATE: Array<Omit<SeedDeliverable, "projectCode">> = [
  { code: "D01", name: "งานเตรียมการและรื้อถอน", sortOrder: 1 },
  { code: "D02", name: "งานเสาเข็ม", sortOrder: 2 },
  { code: "D03", name: "งานฐานราก", sortOrder: 3 },
  { code: "D04", name: "งานโครงสร้าง คสล.", sortOrder: 4 },
];

export function buildDeliverables(): SeedDeliverable[] {
  return SEED_PROJECTS.flatMap((project) =>
    DELIVERABLE_TEMPLATE.map((d) => ({ projectCode: project.code, ...d })),
  );
}

export type SeedPurchaseRequest = {
  projectCode: string;
  wpCode?: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  status: "requested" | "approved"; // GL-safe: posting happens at receipt, never here
};

const PR_TEMPLATE: Array<Omit<SeedPurchaseRequest, "projectCode">> = [
  {
    wpCode: "@4",
    itemDescription: "ปูนซีเมนต์ปอร์ตแลนด์ 50 กก.",
    quantity: 40,
    unit: "ถุง",
    status: "approved",
  },
  {
    wpCode: "@4",
    itemDescription: "เหล็กเส้น DB16",
    quantity: 120,
    unit: "เส้น",
    status: "requested",
  },
  {
    wpCode: "@5",
    itemDescription: "ไม้แบบ 1x8 นิ้ว",
    quantity: 60,
    unit: "แผ่น",
    status: "approved",
  },
  { wpCode: "@6", itemDescription: "ลวดผูกเหล็ก", quantity: 20, unit: "กก.", status: "requested" },
  {
    itemDescription: "น้ำมันดีเซลสำหรับเครื่องจักร",
    quantity: 200,
    unit: "ลิตร",
    status: "requested",
  },
];

// "@n" in the template = bind to that WP number's per-project code.
export function buildPurchaseRequests(): SeedPurchaseRequest[] {
  return SEED_PROJECTS.flatMap((project, pi) =>
    PR_TEMPLATE.map((t) => ({
      projectCode: project.code,
      itemDescription: t.itemDescription,
      quantity: t.quantity,
      unit: t.unit,
      status: t.status,
      ...(t.wpCode ? { wpCode: `SBX-${pi + 1}${t.wpCode.slice(1).padStart(2, "0")}` } : {}),
    })),
  );
}

export type SeedDailyPlan = {
  projectCode: string;
  planDate: string; // yyyy-mm-dd (tomorrow relative to seed run)
  wpCodes: string[];
};

// Tomorrow's work board (spec 273 แผนพรุ่งนี้): the in-progress/not-started
// WPs an SA would realistically queue for the next day.
export function buildDailyPlan(baseDate: Date): SeedDailyPlan[] {
  // "Tomorrow" in Asia/Bangkok (UTC+7) — the board's audience timezone; a UTC
  // date flips a day early around local midnight.
  const planDate = new Date(baseDate.getTime() + (24 + 7) * 3_600_000).toISOString().slice(0, 10);
  const wps = buildWorkPackages();
  return SEED_PROJECTS.map((project) => ({
    projectCode: project.code,
    planDate,
    wpCodes: wps
      .filter(
        (w) =>
          w.projectCode === project.code &&
          (w.status === "in_progress" || w.status === "not_started"),
      )
      .slice(0, 4)
      .map((w) => w.code),
  }));
}
