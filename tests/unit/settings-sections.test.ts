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
  it("procurement master-data: full back-office list, NO customers, NO ช่าง roster", () => {
    // Spec 266 U6: /workers moved out of master-data into the ทีมช่าง section.
    expect(hrefs("master-data", "procurement")).toEqual([
      "/contacts/vendors",
      "/contacts/subcontractors",
      "/equipment",
      // Spec 268: the rental recorder door (the page re-gates BACK_OFFICE_ROLES).
      "/equipment/rentals",
      "/catalog",
      "/settings/ordering-templates",
    ]);
  });

  // Spec 261 / ADR 0070: procurement_manager is a superset of procurement — it
  // sees the SAME back-office cards (still NO customers: that stays isManagerRole,
  // and procurement_manager is not a project-manager). Menu visibility only.
  it("procurement_manager master-data matches procurement (back-office, NO customers)", () => {
    expect(hrefs("master-data", "procurement_manager")).toEqual(
      hrefs("master-data", "procurement"),
    );
    expect(hrefs("master-data", "procurement_manager")).not.toContain("/contacts/customers");
    // Spec 266 U6: ค่าแรง left finance for the ทีมช่าง section.
    expect(hrefs("finance", "procurement_manager")).toEqual([]);
    expect(hrefs("labor-team", "procurement_manager")).toEqual(["/workers", "/payroll"]);
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

  it("ทีมช่าง groups the ช่าง roster + ค่าแรง for the back-office tier (spec 266 U6)", () => {
    // The new section holds the roster + payroll, moved out of master-data + finance;
    // same audience (isBackOffice), so no door's visibility widens or narrows.
    expect(hrefs("labor-team", "procurement")).toEqual(["/workers", "/payroll"]);
    expect(hrefs("labor-team", "project_manager")).toEqual(["/workers", "/payroll"]);
    expect(hrefs("labor-team", "super_admin")).toEqual(["/workers", "/payroll"]);
    expect(hrefs("labor-team", "accounting")).toEqual([]);
  });

  it("accounting role sees NO finance section on /settings (spec 166 nesting pin)", () => {
    expect(hrefs("finance", "accounting")).toEqual([]);
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
