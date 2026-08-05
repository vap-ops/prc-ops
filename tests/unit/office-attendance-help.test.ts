// Writing failing test first.
//
// Spec 397 U6 — the teaching half. The operator's second ask was that the site
// office team does not know how to take their own attendance; U5 built the
// surface, this unit writes the instruction.
//
// Two things this file pins, both learned the expensive way on this very spec:
//
//   1. PROSE THAT INSTRUCTS A USER IS A FACTUAL CLAIM ABOUT AFFORDANCES ON
//      SCREEN. Nothing type-checks a help card, so a step naming a button that
//      does not exist survives indefinitely (spec 313 U7 shipped four such
//      sentences). Every control the card names is asserted to exist in
//      `/team/office`'s own source, and the card is asserted NOT to promise a
//      scan — U5 deliberately ships a `<select>` + `method: 'manual'` (§9 Q11).
//
//   2. A HELPER SENTENCE MUST NOT NAME A STEP THE READER'S ROLE CANNOT TAKE.
//      That was U3's 🔴 #2, and U5 shipped it again: the roster-empty copy said
//      "ต้องเพิ่มรายชื่อ (ค่าแรง 0) ที่ /workers ก่อน" while `/workers` is gated on
//      WORKER_ROSTER_ROLES — which does NOT contain `site_admin`, this page's
//      primary audience. The role invariant is pinned below so the branch cannot
//      quietly become dead code either.
//
// The card lives in HELP_CARDS (the /sa/help SSOT) and is ALSO rendered on
// /team/office. That is not duplication, it is placement: `/sa/help` drew 4 route
// views from 3 users in the last 30 days against 512 for `/team`, so a guide that
// existed only in the คู่มือ hub would be the "correct detector on a page nobody
// opens" failure. One content source, two renders.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SA_SURFACE_ROLES, WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";
import { OFFICE_TEAM_LABEL, USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { HELP_CARDS, OFFICE_ATTENDANCE_HELP } from "@/lib/sa/help-content";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const page = strip(readFileSync("src/app/team/office/page.tsx", "utf8"));
const steps = OFFICE_ATTENDANCE_HELP.steps.join(" · ");
const prose = `${steps} · ${OFFICE_ATTENDANCE_HELP.whenToUse} · ${OFFICE_ATTENDANCE_HELP.tip ?? ""}`;

describe("spec 397 U6 — the card is part of the คู่มือ, in daily-use order", () => {
  it("sits in HELP_CARDS right after the crew muster card", () => {
    const ids = HELP_CARDS.map((c) => c.id);
    expect(ids).toContain(OFFICE_ATTENDANCE_HELP.id);
    // Same activity class as เช็คชื่อทีมงาน, so it belongs beside it — and ahead of
    // the troubleshooting card, which the existing order keeps last.
    expect(ids.indexOf(OFFICE_ATTENDANCE_HELP.id)).toBe(ids.indexOf("muster") + 1);
    expect(ids.indexOf(OFFICE_ATTENDANCE_HELP.id)).toBeLessThan(ids.indexOf("cold-restart"));
  });

  it("names the surface by its SSOT label, not a retyped literal", () => {
    expect(OFFICE_ATTENDANCE_HELP.title).toContain(OFFICE_TEAM_LABEL);
  });
});

describe("spec 397 U6 — every step names a control /team/office actually renders", () => {
  // The card walks the whole loop: open the day, check someone in, check them
  // out, undo a mistake. Each literal is asserted on BOTH sides — the prose and
  // the page — so a rename on either side reds instead of orphaning the other.
  it.each(["เปิดทีมสำนักงาน", "บันทึกเข้างาน", "ออกงาน", "เอาออก"])(
    "the step naming %s matches a control in the page source",
    (affordance) => {
      expect(steps).toContain(affordance);
      expect(page).toContain(affordance);
    },
  );

  it("distinguishes เอาออก from ออกงาน — the mistake path is not the exit path", () => {
    // Checking out only stamps a time. A wrong person added here loses their crew
    // check-in for the day (one team per worker), so the card must not leave the
    // reader thinking ออกงาน undoes it.
    expect(steps).toContain("เอาออก");
    expect(prose).toMatch(/ผิด/);
  });
});

describe("spec 397 U6 — the card promises no scanner, because there is none", () => {
  it("never tells the reader to scan a badge", () => {
    // U5 ships a `<select>` and records `method: 'manual'` (§9 Q11) — claiming a
    // QR scan would both send the reader hunting for a camera button and put a
    // lie in the audit report.
    expect(prose).not.toContain("สแกน");
    expect(prose).not.toContain("QR");
  });

  it("and the premise holds: the add control is a select, not a scanner", () => {
    // A positive control for the assertion above — without it, "no scan" would
    // read as satisfied on a page that had grown one.
    expect(count(page, "<select")).toBe(1);
    expect(page).not.toContain("Scan");
  });
});

describe("spec 397 U6 — nobody is told to take a step their role cannot take", () => {
  it("site_admin can open this page but NOT the roster page — the reason the branch exists", () => {
    // Pinned as an exhaustive intersection, not a hand-list: if `site_admin` is
    // ever added to WORKER_ROSTER_ROLES the role-aware branch becomes dead code
    // and this test says so before the copy drifts.
    expect(SA_SURFACE_ROLES).toContain("site_admin");
    expect(WORKER_ROSTER_ROLES).not.toContain("site_admin");
    const rosterCapableViewers = SA_SURFACE_ROLES.filter((r) =>
      WORKER_ROSTER_ROLES.includes(r),
    ).toSorted();
    expect(rosterCapableViewers).toEqual(["procurement_manager", "super_admin"]);
  });

  it("the card asks the roster-capable roles by NAME instead of linking the reader there", () => {
    const tip = OFFICE_ATTENDANCE_HELP.tip ?? "";
    expect(tip).toContain(USER_ROLE_LABEL.project_manager);
    expect(tip).toContain(USER_ROLE_LABEL.procurement);
    // The card is read by site_admin far more than by anyone else; sending them
    // to a route that redirects them is the U3 🔴 #2 defect.
    expect(prose).not.toContain("/workers");
  });

  it("and it names the choice that makes the row wage-free", () => {
    // `day_rate = 0` IS the office mechanism (§5.1), and the add form writes it
    // whenever การจ่าย = รายเดือน (worker-roster-manager.tsx) — that one choice is
    // the whole data op, so the card states it rather than a rate to type.
    expect(OFFICE_ATTENDANCE_HELP.tip ?? "").toContain("รายเดือน");
  });
});

describe("spec 397 U6 — /team/office renders the guide where the task is", () => {
  it("renders the card once, from the shared content SSOT", () => {
    expect(count(page, "OFFICE_ATTENDANCE_HELP")).toBe(2); // the import + one render
    expect(count(page, "<HelpCard card={OFFICE_ATTENDANCE_HELP} />")).toBe(1);
  });

  it("renders it BEFORE the open/not-open split, so a first-timer sees step 1", () => {
    // Inside the `teamId === null ? … : …` ternary the guide would appear in only
    // one of the two states — and the state a beginner is in every morning is the
    // one where the team is not open yet.
    const guide = page.indexOf("<HelpCard");
    const split = page.indexOf("teamId === null ?");
    expect(guide).toBeGreaterThan(-1);
    expect(split).toBeGreaterThan(-1);
    expect(guide).toBeLessThan(split);
  });

  it("the roster-empty arm is role-aware and no longer quotes a bare path", () => {
    expect(count(page, "WORKER_ROSTER_ROLES.includes(ctx.role)")).toBe(1);
    // One link, in the one arm whose reader can actually open it.
    expect(count(page, 'href="/workers"')).toBe(1);
    // The retired U5 sentence, pinned BARE — the quoted form would pass on a
    // revert to plain JSX text.
    expect(page).not.toContain("ที่ /workers");
  });
});
