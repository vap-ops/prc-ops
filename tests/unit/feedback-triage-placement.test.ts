// The super_admin's open-feedback triage COUNT belongs on /settings (the
// app-admin surface), not the ภาพรวม dashboard — the dashboard is about project
// content, not app-admin counts (feedback 152d2e34; operator decision 2026-06-26
// "relocate to /settings"). This guards the relocation both ways.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("open-feedback triage count placement", () => {
  it("is NOT surfaced on the ภาพรวม dashboard", () => {
    const dash = read("src/app/dashboard/page.tsx");
    expect(dash).not.toContain("getOpenFeedbackCount");
    expect(dash).not.toContain("เรื่องแจ้งใหม่รอตรวจ");
  });

  it("is surfaced on /settings, on the /feedback/review (รายการที่แจ้งเข้ามา) link", () => {
    const settings = read("src/app/settings/page.tsx");
    expect(settings).toContain("getOpenFeedbackCount");
    expect(settings).toContain("/feedback/review");
  });
});
