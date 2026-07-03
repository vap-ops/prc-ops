// Payroll CSV export gate parity. The /payroll page admits PAYROLL_VIEW_ROLES
// (spec 187 gave procurement full director parity; spec 252 admitted accounting
// read-only) and renders the ดาวน์โหลด CSV button for every viewer — but the
// export route kept spec 69's original requireRole(PM_ROLES), so procurement
// and accounting saw the button and were refused on click. The CSV is the same
// derived read as the page (spec 69: same fetch + aggregation, write-free), so
// the two surfaces must gate on the SAME view set. Source-scan pin, same style
// as project-config-placement.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAYROLL = join(process.cwd(), "src", "app", "payroll");
const read = (...segs: string[]) => readFileSync(join(PAYROLL, ...segs), "utf8");

describe("payroll export gate parity (specs 69/187/252)", () => {
  it("the export route gates on PAYROLL_VIEW_ROLES, matching the page", () => {
    const route = read("export", "route.ts");
    expect(route).toContain("requireRole(PAYROLL_VIEW_ROLES)");
  });

  it("the export route no longer gates on the bare PM set", () => {
    const route = read("export", "route.ts");
    expect(route).not.toContain("requireRole(PM_ROLES)");
  });

  it("the page still gates on PAYROLL_VIEW_ROLES (the set the button is shown to)", () => {
    const page = read("page.tsx");
    expect(page).toContain("requireRole(PAYROLL_VIEW_ROLES)");
  });
});
