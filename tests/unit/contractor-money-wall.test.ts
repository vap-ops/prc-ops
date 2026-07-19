// Writing failing test first.
//
// Spec 328 §2.4 — the contractor-member money wall, pinned as an INVENTORY.
// workers.contractor_id IS NOT NULL ⇒ pay-exempt subcon member (the firm pays
// them; PRC never does). Every surface that feeds workers into a pay path must
// exclude contractor-tied rows. Behavior pins live next to each surface
// (labor-group-workers / fetch-zone-data / payout-nominee-bankless tests); this
// file source-pins the query-level filters that have no unit seam of their own,
// so a refactor that drops one fails CI loudly instead of silently reopening
// the wall.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function src(path: string): string {
  return readFileSync(path, "utf8");
}

describe("spec 328 §2.4 — contractor money wall (query pins)", () => {
  it("sa/plan crew picker excludes contractor-tied workers (crew → mark-present → labor_logs)", () => {
    const page = src("src/app/sa/plan/page.tsx");
    const workersRead = page.slice(page.indexOf('from("workers")'));
    expect(workersRead).toContain('.is("contractor_id", null)');
  });

  it("payout-nominee bankless picker excludes contractor-tied workers", () => {
    expect(src("src/lib/payroll/payout-nominee.ts")).toContain('.is("contractor_id", null)');
  });

  it("WP capture picker (groupRoster) excludes contractor-tied workers", () => {
    expect(src("src/lib/labor/group-workers.ts")).toContain("w.contractor_id === null");
  });
});
