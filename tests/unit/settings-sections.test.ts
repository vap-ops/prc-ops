// Settings hub regroup — the SECTIONS config is the SSOT for which roles see
// which entries on /settings. This matrix pins today's role gating exactly so
// the grouped-card refactor cannot widen or narrow any door. Notable pins:
// - procurement never sees ลูกค้า (customers are a manager concern).
// - the `accounting` role sees NO การเงิน section on /settings at all — its
//   บัญชี entry is reachable only through the manager-gated section, matching
//   the pre-refactor isManager nesting (spec 166). Do not widen.
// - Nova live link + feedback triage + admin tools stay super_admin-only.

import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, visibleEntries, type SettingsSection } from "@/app/settings/sections";
import type { UserRole } from "@/lib/auth/role-home";
import { CATALOG_LABEL, ORDERING_TEMPLATES_LABEL, SUBCONTRACTOR_LABEL } from "@/lib/i18n/labels";

const section = (key: string): SettingsSection => {
  const found = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!found) throw new Error(`missing section ${key}`);
  return found;
};

const hrefs = (key: string, role: UserRole): string[] =>
  visibleEntries(section(key), role).map((e) => (e.kind === "link" ? e.href : `soon:${e.key}`));

describe("settings sections config (role → entries matrix)", () => {
  // Spec 323 U4: the procurement tiers reach reference data through the
  // /procurement STR hub's Scope/Resources doors now — their ตั้งค่า drops the
  // whole ข้อมูลหลัก section. Procurement-scoped ONLY: every other back-office
  // role keeps its doors (rule 8 holds for them; ui-conventions §12).
  it("procurement master-data: EMPTY — reference data lives on the /procurement hub (spec 323 U4)", () => {
    expect(hrefs("master-data", "procurement")).toEqual([]);
  });

  // Spec 261 / ADR 0070: procurement_manager is a superset of procurement — the
  // same relocation applies (both tiers land on the STR hub). Menu visibility only.
  it("procurement_manager master-data matches procurement (relocated to the hub)", () => {
    expect(hrefs("master-data", "procurement_manager")).toEqual(
      hrefs("master-data", "procurement"),
    );
    expect(hrefs("master-data", "procurement_manager")).toEqual([]);
    // Spec 266 U6: ค่าแรง left finance for the ทีมช่าง section.
    expect(hrefs("finance", "procurement_manager")).toEqual([]);
    // Spec 314 U2: procurement_manager also holds the money-set rate editor.
    // ทีมช่าง deliberately SURVIVES the U4 relocation (spec lists only the
    // master-data doors + expenses; the roster/payroll doors stay dual-homed).
    expect(hrefs("labor-team", "procurement_manager")).toEqual([
      "/workers",
      "/payroll",
      "/settings/labor-rates",
    ]);
  });

  it("project_manager master-data: customers first, 7 entries (ช่าง roster moved out)", () => {
    const list = hrefs("master-data", "project_manager");
    expect(list[0]).toBe("/contacts/customers");
    // Spec 266 U6: was 7; /workers moved to the ทีมช่าง section.
    // Spec 268: +1 — the เช่าอุปกรณ์ rental-recorder door.
    expect(list).toHaveLength(7);
  });

  it("site_admin: field equipment only; master-data/labor-team/finance/admin empty", () => {
    expect(hrefs("field", "site_admin")).toEqual(["/equipment"]);
    expect(hrefs("master-data", "site_admin")).toEqual([]);
    expect(hrefs("labor-team", "site_admin")).toEqual([]);
    expect(hrefs("finance", "site_admin")).toEqual([]);
    expect(hrefs("admin", "site_admin")).toEqual([]);
  });

  it("field section is site_admin-only", () => {
    for (const role of ["project_manager", "procurement", "super_admin"] as const) {
      expect(hrefs("field", role)).toEqual([]);
    }
  });

  it("finance: ค่าแรง moved to ทีมช่าง; accounting+Nova stay narrow", () => {
    // Spec 266 U6: /payroll left finance → finance is empty for the write tier
    // (accounting is ACCOUNTING_ROLES-only, Nova super_admin-only).
    expect(hrefs("finance", "procurement")).toEqual([]);
    expect(hrefs("finance", "project_manager")).toEqual([]);
    expect(hrefs("finance", "super_admin")).toEqual(["/accounting", "/nova"]);
  });

  it("company-docs: its own section so accounting + legal reach it (spec 329)", () => {
    // การเงิน deliberately excludes accounting (spec 166 nesting pin) — the
    // document library follows the office-expenses own-section precedent.
    for (const role of [
      "accounting",
      "legal",
      "project_manager",
      "project_director",
      "procurement",
      "procurement_manager",
      "super_admin",
    ] as const) {
      expect(hrefs("company-docs", role)).toEqual(["/settings/company-docs"]);
    }
    expect(hrefs("company-docs", "site_admin")).toEqual([]);
    expect(hrefs("company-docs", "technician")).toEqual([]);
  });

  it("ทีมช่าง groups the ช่าง roster + ค่าแรง for the back-office tier (spec 266 U6)", () => {
    // The new section holds the roster + payroll, moved out of master-data + finance;
    // same audience (isBackOffice), so no door's visibility widens or narrows.
    expect(hrefs("labor-team", "procurement")).toEqual(["/workers", "/payroll"]);
    expect(hrefs("labor-team", "project_manager")).toEqual(["/workers", "/payroll"]);
    // Spec 314 U2: super_admin additionally sees the money-set rate editor.
    expect(hrefs("labor-team", "super_admin")).toEqual([
      "/workers",
      "/payroll",
      "/settings/labor-rates",
    ]);
    expect(hrefs("labor-team", "accounting")).toEqual([]);
  });

  it("accounting role sees NO finance section on /settings (spec 166 nesting pin)", () => {
    expect(hrefs("finance", "accounting")).toEqual([]);
  });

  it("office-expenses: reaches OFFICE_EXPENSE_ROLES incl PM/PD/site/auditor (spec 310 U6), not field-only roles", () => {
    for (const role of [
      "super_admin",
      "accounting",
      "project_manager",
      "project_director",
      "site_owner",
      "site_admin",
      "auditor",
    ] as const) {
      expect(hrefs("office-expenses", role)).toEqual(["/expenses"]);
    }
    expect(hrefs("office-expenses", "technician")).toEqual([]);
    expect(hrefs("office-expenses", "visitor")).toEqual([]);
  });

  // Spec 323 U4: ค่าใช้จ่าย is the STR hub's Resources door for the procurement
  // tiers — it leaves their ตั้งค่า (site_owner/auditor and the rest of
  // OFFICE_EXPENSE_ROLES keep the settings door; /expenses is their home surface).
  it("office-expenses: hidden from the procurement tiers (hub door instead, spec 323 U4)", () => {
    expect(hrefs("office-expenses", "procurement")).toEqual([]);
    expect(hrefs("office-expenses", "procurement_manager")).toEqual([]);
  });

  it("help: everyone files feedback; only super_admin sees the triage inbox", () => {
    expect(hrefs("help", "site_admin")).toEqual(["/feedback"]);
    expect(hrefs("help", "super_admin")).toEqual(["/feedback", "/feedback/review"]);
  });

  it("coming-soon: Nova preview hidden from super_admin (live link elsewhere)", () => {
    expect(hrefs("coming-soon", "super_admin")).toEqual(["soon:docs"]);
    expect(hrefs("coming-soon", "site_admin")).toEqual(["soon:nova", "soon:docs"]);
  });

  it("admin tools are super_admin-only", () => {
    expect(hrefs("admin", "super_admin")).toEqual([
      // Spec 283: System Integrity Console (ตรวจระบบ).
      "/settings/integrity",
      // Spec 310: company-card registry.
      "/settings/cards",
      "/settings/roles",
      // Spec 284 / ADR 0080: the org chart (departments → head → members).
      "/settings/org-chart",
      // Spec 274: super_admin "view as role" picker.
      "/settings/view-as",
      "/settings/usage",
      "/settings/friction-map",
    ]);
    expect(hrefs("admin", "project_manager")).toEqual([]);
  });

  it("labels come from the i18n SSOT constants", () => {
    const master = section("master-data").entries;
    const labels = master.map((e) => e.label);
    expect(labels).toContain(SUBCONTRACTOR_LABEL);
    expect(labels).toContain(CATALOG_LABEL);
    expect(labels).toContain(ORDERING_TEMPLATES_LABEL);
  });
});

// Spec 317 U2 — ข้อมูลของฉัน: the first ALL-ROLES settings section. Every login
// (field, office, external, even visitor) reaches /settings/my-info.
describe("my-info section (spec 317 U2)", () => {
  const ALL: UserRole[] = [
    "visitor",
    "technician",
    "contractor",
    "site_admin",
    "project_manager",
    "procurement",
    "accounting",
    "super_admin",
  ];
  it("is visible to every role and links to /settings/my-info", () => {
    for (const role of ALL) {
      expect(hrefs("my-info", role)).toContain("/settings/my-info");
    }
  });
  it("is the FIRST section (identity before tools)", () => {
    expect(SETTINGS_SECTIONS[0]?.key).toBe("my-info");
  });
});
