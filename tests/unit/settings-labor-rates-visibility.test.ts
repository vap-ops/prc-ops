// Spec 314 U2 — the ค่าแรงมาตรฐาน (labor-rates) door lives in the ทีมช่าง
// section but is gated NARROWER than the section: it sets money (the firm-wide
// level standard rate + WHT %), so only procurement_manager + super_admin see
// it — matching the DEFINER RPCs' exact gate (set_level_rate / set_labor_wht_pct
// allow ('procurement_manager','super_admin') only). The section itself stays
// isBackOffice; project_manager / procurement keep /workers + /payroll but NOT
// the rate editor.

import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, visibleEntries, type SettingsSection } from "@/app/settings/sections";
import type { UserRole } from "@/lib/auth/role-home";
import { LABOR_RATES_LABEL } from "@/lib/i18n/labels";

const LABOR_RATES_HREF = "/settings/labor-rates";

const section = (key: string): SettingsSection => {
  const found = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!found) throw new Error(`missing section ${key}`);
  return found;
};

const hrefs = (key: string, role: UserRole): string[] =>
  visibleEntries(section(key), role).map((e) => (e.kind === "link" ? e.href : `soon:${e.key}`));

describe("spec 314 U2 — /settings/labor-rates door visibility", () => {
  it("procurement_manager + super_admin see the rate editor in ทีมช่าง", () => {
    expect(hrefs("labor-team", "procurement_manager")).toContain(LABOR_RATES_HREF);
    expect(hrefs("labor-team", "super_admin")).toContain(LABOR_RATES_HREF);
  });

  it("money-set gate: project_manager / procurement do NOT see it (keep roster + payroll)", () => {
    // The section is isBackOffice, so these roles see /workers + /payroll — but the
    // rate editor is money-set (PM_manager/super only), so it must be absent for them.
    expect(hrefs("labor-team", "project_manager")).not.toContain(LABOR_RATES_HREF);
    expect(hrefs("labor-team", "procurement")).not.toContain(LABOR_RATES_HREF);
    expect(hrefs("labor-team", "project_director")).not.toContain(LABOR_RATES_HREF);
  });

  it("field/visitor roles see nothing in ทีมช่าง (section hidden)", () => {
    expect(hrefs("labor-team", "site_admin")).toEqual([]);
    expect(hrefs("labor-team", "visitor")).toEqual([]);
  });

  it("the entry uses the i18n SSOT label", () => {
    const entry = section("labor-team").entries.find(
      (e) => e.kind === "link" && e.href === LABOR_RATES_HREF,
    );
    expect(entry?.label).toBe(LABOR_RATES_LABEL);
  });
});
