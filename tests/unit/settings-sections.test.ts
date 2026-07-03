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
  it("procurement master-data: full back-office list, NO customers", () => {
    expect(hrefs("master-data", "procurement")).toEqual([
      "/contacts/vendors",
      "/contacts/subcontractors",
      "/workers",
      "/equipment",
      "/catalog",
      "/settings/ordering-templates",
    ]);
  });

  it("project_manager master-data: customers first, 7 entries", () => {
    const list = hrefs("master-data", "project_manager");
    expect(list[0]).toBe("/contacts/customers");
    expect(list).toHaveLength(7);
  });

  it("site_admin: field equipment only; master-data/finance/admin empty", () => {
    expect(hrefs("field", "site_admin")).toEqual(["/equipment"]);
    expect(hrefs("master-data", "site_admin")).toEqual([]);
    expect(hrefs("finance", "site_admin")).toEqual([]);
    expect(hrefs("admin", "site_admin")).toEqual([]);
  });

  it("field section is site_admin-only", () => {
    for (const role of ["project_manager", "procurement", "super_admin"] as const) {
      expect(hrefs("field", role)).toEqual([]);
    }
  });

  it("finance: payroll for the write tier; accounting+Nova stay narrow", () => {
    expect(hrefs("finance", "procurement")).toEqual(["/payroll"]);
    expect(hrefs("finance", "project_manager")).toEqual(["/payroll"]);
    expect(hrefs("finance", "super_admin")).toEqual(["/payroll", "/accounting", "/nova"]);
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
      "/settings/roles",
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
