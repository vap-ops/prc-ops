// Spec 397 U2 — the attendance-audit DOOR on /procurement.
//
// U1 gave `procurement` the permission; this unit gives it a way in. The tile on
// /team is not that way: `procurement_manager` has held this permission since
// spec 358 and has never opened /team once (0 route views in 30 days against
// /procurement 3396), so the door has to be where that audience already stands.
//
// Two things are pinned here, and the second is the one that bites:
//   1. the card exists on the procurement dashboard, threads ?from, and is gated
//      on ATTENDANCE_AUDIT_ROLES (not on a restated role literal);
//   2. the destination's back chip is LABELLED for where it actually goes. The
//      chip was a two-arm ternary (accounting → "บัญชี", else "ทีมงาน"), so a
//      /procurement referrer would have travelled back to /procurement under the
//      label "ทีมงาน" — the aria-label a screen reader announces. Adding a parent
//      to a multi-parent page is therefore a change to its LABEL resolution, not
//      just to a link.
//
// dashboard-body.tsx and the attendance page are async Server Components vitest
// cannot render, so the surface assertions are comment-stripped source pins with
// exact occurrence counts (the house idiom). The label resolution is a pure
// function and is tested behaviourally over its whole input domain.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { attendanceBackLabel } from "@/lib/nav/back-href";
import { ATTENDANCE_AUDIT_ROLES } from "@/lib/auth/role-home";
import { PROCUREMENT_HOME_ROLES } from "@/app/procurement/hub-body";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const dash = strip(readFileSync("src/app/procurement/dashboard-body.tsx", "utf8"));
const attendancePage = strip(readFileSync("src/app/team/attendance/page.tsx", "utf8"));

describe("spec 397 U2 — the attendance door on /procurement", () => {
  it("every role that can open the procurement home may also open the report", () => {
    // The card renders for whoever reaches the dashboard, so if these ever
    // diverge the page would show a door that 42501s. U1 made this true; this
    // assertion is what keeps it true.
    for (const role of PROCUREMENT_HOME_ROLES) {
      expect(ATTENDANCE_AUDIT_ROLES).toContain(role);
    }
  });

  it("the dashboard links the report exactly once, threading its own ?from", () => {
    expect(count(dash, 'withBackFrom("/team/attendance", "/procurement")')).toBe(1);
    // No bare link to the report may survive beside it — a second, unthreaded
    // door would send the user back to /team from a page they never came from.
    expect(count(dash, '"/team/attendance"')).toBe(1);
  });

  it("the door is gated on the audit role set, never on a restated literal", () => {
    expect(count(dash, "ATTENDANCE_AUDIT_ROLES.includes(role)")).toBe(1);
    expect(count(dash, "ATTENDANCE_AUDIT_ROLES")).toBe(2); // the import + that call
  });

  it("the card carries the report's SSOT label, not a hand-typed string", () => {
    expect(count(dash, "ATTENDANCE_AUDIT_LABEL")).toBe(2); // the import + one render
    expect(dash).not.toContain("ประวัติการเช็คชื่อ"); // the literal belongs in labels.ts
  });
});

describe("spec 397 U2 — the back chip names where it actually goes", () => {
  it("labels a /procurement referrer จัดซื้อ", () => {
    expect(attendanceBackLabel("/procurement")).toBe("จัดซื้อ");
    expect(attendanceBackLabel("/procurement/scope")).toBe("จัดซื้อ");
  });

  it("keeps the two arms that already existed", () => {
    expect(attendanceBackLabel("/accounting")).toBe("บัญชี");
    expect(attendanceBackLabel("/accounting/register")).toBe("บัญชี");
    expect(attendanceBackLabel("/team")).toBe("ทีมงาน");
  });

  it("falls back to ทีมงาน for anything else — never an empty or wrong name", () => {
    // safeBackHref can only ever return an app path or the /team fallback, so an
    // unknown value here means a NEW parent nobody labelled: the honest answer is
    // the hierarchical parent's name, which is also where the fallback lands.
    for (const href of ["/dashboard", "/sa", "/", "/workers"]) {
      expect(attendanceBackLabel(href)).toBe("ทีมงาน");
    }
  });

  it("is what the attendance page actually uses (no inline ternary left)", () => {
    expect(count(attendancePage, "attendanceBackLabel")).toBe(2); // import + call
    expect(attendancePage).not.toContain('startsWith("/accounting") ? "บัญชี"');
  });
});
