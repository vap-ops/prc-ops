import { describe, expect, it } from "vitest";
import { TEAM_HUB_LABEL, WORKER_ROSTER_LABEL, LABOR_TAB_LABEL } from "@/lib/i18n/labels";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("spec 313 D4 — one term per concept", () => {
  it("pins the three nav terms", () => {
    expect(TEAM_HUB_LABEL).toBe("ทีมงาน");
    expect(WORKER_ROSTER_LABEL).toBe("รายชื่อช่าง");
    expect(LABOR_TAB_LABEL).toBe("แรงงาน");
  });

  it("the WP labor tab + SA chip no longer use the literal ทีมงาน", () => {
    const wp = read("src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx");
    expect(wp).toContain("LABOR_TAB_LABEL");
    const sa = read("src/app/sa/page.tsx");
    expect(sa).toContain("LABOR_TAB_LABEL");
  });

  it("/workers is titled รายชื่อช่าง, not ทีมงาน", () => {
    const w = read("src/app/workers/page.tsx");
    expect(w).toContain("WORKER_ROSTER_LABEL");
    expect(w).not.toContain('title: "ทีมงาน"');
  });
});
