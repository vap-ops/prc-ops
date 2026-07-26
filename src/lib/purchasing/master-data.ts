// Spec 361 U4 — the master-data (ข้อมูลหลัก) SSOT: which reference lists the
// firm keeps, where each one is curated, and which have no in-app editor yet.
//
// Operator ask 2026-07-26: "group catalog settings for her, like
// materials/staffs on-site/rentals/other expenses". The GROUP ORDER below is
// that sentence — it is a contract, pinned in master-data-hub.test.ts, not a
// layout choice.
//
// `editorPending: true` marks a list that exists in the database, is readable,
// and has NO write surface in the app today (spec 361 §1.3). Those rows render
// as facts with a count, never as a link — a tile that opens nothing is the
// affordance-then-refuse shape. Each becomes a link as its unit lands:
// หน่วยนับ → U8 · หมวดอุปกรณ์ → U6 · สายงาน → U7 · ประเภทค่าใช้จ่าย → U5.
//
// No I/O here — the page counts the rows and passes them in.

import {
  CATALOG_LABEL,
  EXPENSE_CATEGORY_LABEL,
  LABOR_RATES_LABEL,
  MANAGE_TAXONOMY_LABEL,
  ORDERING_TEMPLATES_LABEL,
  SUBCONTRACTOR_LABEL,
  TRADE_LABEL,
} from "@/lib/i18n/labels";

/** Row counts the hub displays — null = the count could not be read (never 0). */
export interface MasterDataCounts {
  catalogItems: number | null;
  catalogCategories: number | null;
  catalogUnits: number | null;
  orderingTemplates: number | null;
  equipmentItems: number | null;
  equipmentCategories: number | null;
  workCategories: number | null;
  workerLevelRates: number | null;
  expenseCategories: number | null;
  suppliers: number | null;
  contractors: number | null;
}

export type MasterDataCountKey = keyof MasterDataCounts;

export interface MasterDataEntry {
  key: string;
  label: string;
  /** One line saying what the list is FOR — she picks by purpose, not by table. */
  hint: string;
  /** Where it is curated, or null when nothing in the app can edit it yet. */
  href: string | null;
  countKey: MasterDataCountKey;
  /** Mirrors `href === null`; stated explicitly so a dead tile cannot ship by accident. */
  editorPending: boolean;
  /** Money-set lists gated narrower than the page (ค่าแรงมาตรฐาน = pm-tier + super). */
  managerOnly?: boolean;
}

export interface MasterDataGroup {
  key: "materials" | "rentals" | "people" | "expenses" | "partners";
  label: string;
  entries: readonly MasterDataEntry[];
}

export const MASTER_DATA_GROUPS: readonly MasterDataGroup[] = [
  {
    key: "materials",
    label: "วัสดุ",
    entries: [
      {
        key: "catalog-items",
        label: CATALOG_LABEL,
        hint: "รายการวัสดุมาตรฐานที่ใช้ตอนขอซื้อและเบิกของ",
        href: "/catalog",
        countKey: "catalogItems",
        editorPending: false,
      },
      {
        key: "catalog-categories",
        label: MANAGE_TAXONOMY_LABEL,
        hint: "หมวดหลักและหมวดย่อยของวัสดุ · ใช้ตั้งรหัสสินค้า",
        href: "/catalog/subcategories",
        countKey: "catalogCategories",
        editorPending: false,
      },
      {
        key: "catalog-units",
        label: "หน่วยนับ",
        hint: "หน่วยที่เลือกได้ตอนเพิ่มวัสดุ (เส้น · ถุง · ปี๊บ)",
        href: null,
        countKey: "catalogUnits",
        editorPending: true,
      },
      {
        key: "ordering-templates",
        label: ORDERING_TEMPLATES_LABEL,
        hint: "ชุดรายการวัสดุสำเร็จรูปสำหรับตั้งแผนจัดหา",
        href: "/settings/ordering-templates",
        countKey: "orderingTemplates",
        editorPending: false,
      },
    ],
  },
  {
    key: "rentals",
    label: "เช่า · อุปกรณ์",
    entries: [
      {
        key: "equipment-items",
        label: "ทะเบียนอุปกรณ์",
        hint: "อุปกรณ์ของบริษัท · สถานะและที่อยู่ปัจจุบัน",
        href: "/equipment",
        countKey: "equipmentItems",
        editorPending: false,
      },
      // Editable, but only just: /equipment's QuickAddCategory can ADD one
      // (createEquipmentCategory, BACK_OFFICE_ROLES — every role that reaches
      // this hub). Rename and deactivate have no surface at all, so the hint
      // says which half works rather than the row claiming it is uneditable.
      {
        key: "equipment-categories",
        label: "หมวดอุปกรณ์",
        hint: "หมวดของอุปกรณ์และของที่เช่า · เพิ่มได้จากหน้าอุปกรณ์ (ยังเปลี่ยนชื่อ/ปิดใช้งานไม่ได้)",
        href: "/equipment",
        countKey: "equipmentCategories",
        editorPending: false,
      },
    ],
  },
  {
    key: "people",
    label: "คนหน้างาน",
    entries: [
      {
        key: "worker-level-rates",
        label: LABOR_RATES_LABEL,
        hint: "ค่าแรงมาตรฐานต่อระดับฝีมือ · ภาษีหัก ณ ที่จ่าย",
        href: "/settings/labor-rates",
        countKey: "workerLevelRates",
        editorPending: false,
        managerOnly: true,
      },
      {
        key: "work-categories",
        label: TRADE_LABEL,
        hint: "หมวดงานที่ใช้ติดสายงานช่างและตั้งรหัสงานย่อย",
        href: null,
        countKey: "workCategories",
        editorPending: true,
      },
    ],
  },
  {
    key: "expenses",
    label: "ค่าใช้จ่ายอื่น",
    entries: [
      {
        key: "expense-categories",
        label: EXPENSE_CATEGORY_LABEL,
        hint: "หมวดค่าใช้จ่ายสำนักงานที่เลือกได้ตอนบันทึกบิล",
        href: null,
        countKey: "expenseCategories",
        editorPending: true,
      },
    ],
  },
  {
    key: "partners",
    label: "คู่ค้า",
    entries: [
      {
        key: "suppliers",
        label: "ผู้ขาย / ผู้ให้เช่า",
        hint: "ร้านค้าและผู้ให้เช่าที่บริษัทซื้อหรือเช่าด้วย",
        href: "/contacts/vendors",
        countKey: "suppliers",
        editorPending: false,
      },
      {
        key: "contractors",
        label: SUBCONTRACTOR_LABEL,
        hint: "บริษัทที่รับงานช่วง (จ่ายลูกทีมเอง)",
        href: "/contacts/subcontractors",
        countKey: "contractors",
        editorPending: false,
      },
    ],
  },
];

/** Every entry across every group, in render order. */
export function masterDataEntries(): MasterDataEntry[] {
  return MASTER_DATA_GROUPS.flatMap((g) => [...g.entries]);
}

/** The entries a caller may see — manager-only rows drop for the plain tier. */
export function visibleMasterDataEntries(
  group: MasterDataGroup,
  isManager: boolean,
): MasterDataEntry[] {
  return group.entries.filter((e) => !e.managerOnly || isManager);
}
