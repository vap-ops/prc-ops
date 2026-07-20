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

// /team is a HUB — it has no back chip of its own, so every card that drills OUT
// of it must hand the destination a `?from` referrer. Otherwise the destination's
// own back chip falls back to its hierarchical parent and silently ejects the user
// somewhere they never came from.
//
// Spec 313 U3 fixed the คำขอสมัคร card this way (it was landing people on
// /dashboard). The U4 review then found ค่าแรง had the same defect and it was
// recorded as an open question rather than fixed inline. This pins ALL of them
// together so the next one added cannot quietly omit it.
describe("/team drill-downs thread the ?from referrer", () => {
  const DRILL_DOWNS = ["/sa/registrations", "/registrations", "/workers", "/payroll"];

  it.each(DRILL_DOWNS)("%s is wrapped in withBackFrom(..., '/team')", (href) => {
    const src = read("src/app/team/page.tsx");
    const normalised = src.replace(/\s+/g, " ");
    expect(normalised).toContain(`withBackFrom("${href}", "/team")`);
  });

  it("leaves no bare href to a drill-down destination", () => {
    const src = read("src/app/team/page.tsx");
    for (const href of DRILL_DOWNS) {
      expect(src).not.toContain(`href="${href}"`);
    }
  });
});
