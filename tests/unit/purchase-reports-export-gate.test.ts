// Writing failing test first.
//
// Spec 262 U2 — report page/export gate parity. The named anti-pattern this
// guards against (payroll's original bug, spec 187/252): the page renders a
// download button for a role set the export route then refuses on click.
// The page and the route MUST import the exact same gate constant — a
// source-scan pin, same style as payroll-export-gate.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPORTS = join(process.cwd(), "src", "app", "requests", "reports");
const read = (...segs: string[]) => readFileSync(join(REPORTS, ...segs), "utf8");

describe("procurement report export gate parity (spec 262 U2)", () => {
  it("the export route gates on PURCHASE_REPORT_ROLES, matching the page", () => {
    const route = read("export", "route.ts");
    expect(route).toContain("requireRole(PURCHASE_REPORT_ROLES)");
  });

  it("the page gates on PURCHASE_REPORT_ROLES (the set the export link is shown to)", () => {
    const page = read("page.tsx");
    expect(page).toContain("requireRole(PURCHASE_REPORT_ROLES)");
  });

  it("the register drill also gates on PURCHASE_REPORT_ROLES (same report wing)", () => {
    const register = read("register", "page.tsx");
    expect(register).toContain("requireRole(PURCHASE_REPORT_ROLES)");
  });

  it("the itemized (line-level) export route gates on PURCHASE_REPORT_ROLES (FB-4620)", () => {
    const route = read("export-itemized", "route.ts");
    expect(route).toContain("requireRole(PURCHASE_REPORT_ROLES)");
  });
});
