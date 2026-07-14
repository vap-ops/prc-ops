import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("/team hub (spec 313 U1)", () => {
  it("renders hub chrome: HubNav + BottomTabBar, no DetailHeader", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("HubNav");
    expect(src).toContain("BottomTabBar");
    expect(src).not.toContain("DetailHeader");
  });

  it("gates on the union of site staff + worker-roster roles (no new named set)", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("SITE_STAFF_ROLES");
    expect(src).toContain('"procurement"');
    expect(src).toContain('"procurement_manager"');
  });

  it("fronts the เช็คชื่อ cockpit via musterHref for the crew roles", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("musterHref(");
    expect(src).toContain("MUSTER_LABEL");
  });

  it("shows the คำขอสมัคร queue section only to STAFF_APPROVAL_ROLES", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("STAFF_APPROVAL_ROLES");
    expect(src).toContain('"/registrations"');
  });

  it("keeps /sa/crew and /sa/crew/badges as redirects", () => {
    expect(read("src/app/sa/crew/page.tsx")).toContain('redirect("/team")');
    expect(read("src/app/sa/crew/badges/page.tsx")).toContain('redirect("/team/badges")');
  });
});
