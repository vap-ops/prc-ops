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

  // Spec 334 U1 recompose: the flat เช็คชื่อ link became the วันนี้ hero card
  // (MusterTodayCard), fed by the narrow loadMusterDaySummary read — the cockpit is
  // still the single write path the hero links into.
  it("fronts the เช็คชื่อ cockpit via the วันนี้ hero for the crew roles", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("MusterTodayCard");
    expect(src).toContain("loadMusterDaySummary");
  });

  // Spec 334 U3: the คำขอสมัคร queue is now a tile resolved by teamTilesForRole; the
  // page still gates the bubble count on STAFF_APPROVAL_ROLES. The per-audience href
  // ("/sa/registrations" vs "/registrations") moved into the tile SSOT.
  it("resolves the คำขอสมัคร door through the tile SSOT, gated on STAFF_APPROVAL_ROLES", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("STAFF_APPROVAL_ROLES");
    expect(src).toContain("teamTilesForRole");
  });

  it("keeps /sa/crew and /sa/crew/badges as redirects", () => {
    expect(read("src/app/sa/crew/page.tsx")).toContain('redirect("/team")');
    expect(read("src/app/sa/crew/badges/page.tsx")).toContain('redirect("/team/badges")');
  });
});

// /team is a HUB — it has no back chip of its own, so every tile that drills OUT
// of it must hand the destination a `?from` referrer. Otherwise the destination's
// own back chip falls back to its hierarchical parent and silently ejects the user
// somewhere they never came from.
//
// Spec 313 U3 fixed the คำขอสมัคร card this way (it was landing people on
// /dashboard). The U4 review then found ค่าแรง had the same defect. Spec 334 U3
// moved every drill-down into the teamTilesForRole SSOT, so this pins them THERE —
// all together, so the next tile added cannot quietly omit the referrer.
describe("/team drill-downs thread the ?from referrer", () => {
  const DRILL_DOWNS = ["/sa/registrations", "/registrations", "/workers", "/payroll"];
  const TILES = "src/components/features/sa/team-tiles.tsx";

  it.each(DRILL_DOWNS)("%s is wrapped in withBackFrom(..., '/team')", (href) => {
    const normalised = read(TILES).replace(/\s+/g, " ");
    expect(normalised).toContain(`withBackFrom("${href}", "/team")`);
  });

  it("leaves no bare href to a drill-down destination", () => {
    const src = read(TILES);
    for (const href of DRILL_DOWNS) {
      expect(src).not.toContain(`href="${href}"`);
    }
  });
});
