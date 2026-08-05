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

import {
  PM_TABS,
  PROCUREMENT_MANAGER_TABS,
  SA_TABS,
} from "@/components/features/chrome/bottom-tab-bar";
import { SA_SURFACE_ROLES, WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";
import { OFFICE_TEAM_LABEL, TEAM_HUB_LABEL, USER_ROLE_LABEL } from "@/lib/i18n/labels";
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
  //
  // Counted PER STEP, not over the joined string: ออกงาน appears in two steps (the
  // check-out step and the undo step's contrast), so a join-wide `toContain` stays
  // green when the check-out step alone drifts to a button that does not exist.
  // A mutation renaming it to “เลิกงาน” survived exactly that way.
  it.each([
    ["เปิดทีมสำนักงาน", 1],
    ["บันทึกเข้างาน", 1],
    ["ออกงาน", 2],
    ["เอาออก", 1],
  ] as const)("%s is named by %i step(s) and renders as a CONTROL on the page", (a, inSteps) => {
    expect(OFFICE_ATTENDANCE_HELP.steps.filter((s) => s.includes(a))).toHaveLength(inSteps);
    // In BUTTON POSITION, not merely present: `OUTCOME_COPY.opened` contains
    // "เปิดทีมสำนักงาน" and `.out` contains "ออกงาน", so a bare `toContain` over the
    // page stays green with either button renamed — the banner copy alone satisfies
    // it. Matching `>label<` pins the rendered control instead of the sentence.
    expect(page).toMatch(new RegExp(`>\\s*(?:\\{[^}]*\\})?${a}\\s*<`));
  });

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
    // read as satisfied on a page that had grown one. (`not.toContain("Scan")` was
    // here first and was vacuous: a scanner would arrive as a component import, not
    // that word, so the select count is the line doing the work.)
    expect(count(page, "<select")).toBe(1);
  });
});

describe("spec 397 U6 — step 1's door is real too, and it lives off this page", () => {
  // The other steps are pinned against `/team/office`'s own source. Step 1 names
  // chrome the page cannot vouch for, so it is pinned against the nav SSOTs — the
  // idiom sa-help-honesty.test.ts already uses for the `manage` card.
  it("the ทีมงาน tab exists for the roles whose chrome the step describes", () => {
    for (const tabs of [SA_TABS, PM_TABS]) {
      expect(tabs.map((t) => [t.label, t.href])).toContainEqual([TEAM_HUB_LABEL, "/team"]);
    }
    expect(OFFICE_ATTENDANCE_HELP.steps[0]).toContain(`“${TEAM_HUB_LABEL}”`);
  });

  it("the ทีมสำนักงาน door exists on /team, under that exact label", () => {
    const team = strip(readFileSync("src/app/team/page.tsx", "utf8"));
    expect(count(team, 'withBackFrom("/team/office", "/team")')).toBe(1);
    expect(count(team, "OFFICE_TEAM_LABEL")).toBeGreaterThanOrEqual(2);
    expect(OFFICE_ATTENDANCE_HELP.steps[0]).toContain(`“${OFFICE_TEAM_LABEL}”`);
  });

  it("procurement_manager's missing tab is a RECORDED gap, not an accident", () => {
    // It is in SA_SURFACE_ROLES (so it is served this card and may open the page)
    // yet its tab set carries no /team at all — step 1 is unfollowable for it and
    // the surface has no door. Pinned so the gap cannot be silently "fixed" in one
    // direction only; the decision is spec §9 Q15.
    expect(SA_SURFACE_ROLES).toContain("procurement_manager");
    expect(PROCUREMENT_MANAGER_TABS.map((t) => t.href)).not.toContain("/team");
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

  it("the SHARED card prescribes no actor — one sentence cannot be true for both readers", () => {
    // The same card reaches site_admin (who cannot open the roster page) and
    // super_admin (who can, and whose own screen offers the link). An "ask someone
    // else" tip would contradict the link rendered twenty lines below it; a "go add
    // them" tip would send site_admin to a redirect. So the card states the
    // mechanism and defers the actor to the page, which knows the reader.
    const tip = OFFICE_ATTENDANCE_HELP.tip ?? "";
    expect(tip).not.toContain(USER_ROLE_LABEL.project_manager);
    expect(tip).not.toContain(USER_ROLE_LABEL.procurement);
    expect(prose).not.toContain("/workers");
    expect(tip).toContain(OFFICE_TEAM_LABEL);
  });

  it("the PAGE carries the actor split, naming both roster-capable departments", () => {
    expect(count(page, "USER_ROLE_LABEL.project_manager")).toBe(1);
    expect(count(page, "USER_ROLE_LABEL.procurement")).toBe(1);
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
    expect(count(page, "<HelpCard card={OFFICE_ATTENDANCE_HELP}")).toBe(1);
  });

  it("opens the guide on the day's FIRST screen, and only there", () => {
    // A bare <details> is collapsed, so "the guide is on the page" is not the same
    // claim as "the first-timer reads it" — the reviewer caught the comment
    // asserting a state-dependent collapse the component could not express.
    expect(count(page, "open={teamId === null}")).toBe(1);
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
