// Writing failing test first.
//
// Spec 400 U3c-b — "he was here, add him", the correction the whole spec was
// written around, finally reachable.
//
// The three pieces that had to land first: U3a widened `muster_scan_in` to
// `procurement`, U4 gave a correction a real `in_at` (before it, adding someone
// to 08-04 stamped the correction moment and `close_muster_day`'s auto-out then
// produced a ZERO-LENGTH session), and U3c-a added `list_muster_teams_for_day`
// because `muster_teams` RLS refuses `procurement` outright, so the picker was
// empty for 4 of the 5 people the write was widened for.
//
// What is pinned here:
//   1. the control is a PURE function of (date, closure, project, permission,
//      team count) — U1's surviving mutant proved a source scan cannot see
//      reachability, so every arm is driven directly;
//   2. `bangkokInAt` builds the timestamp the RPC receives, and it is the piece
//      that decides WHICH DAY the row lands on;
//   3. MUSTER_CORRECT_ROLES mirrors `muster_correct_session`'s live gate over the
//      exhaustive role domain, and is a SUBSET of MUSTER_REOPEN_ROLES — the
//      implication the "เปิดวันก่อน" copy rests on.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceAddPersonForm } from "@/components/features/muster/attendance-add-person-form";
import { MUSTER_CORRECT_ROLES, MUSTER_REOPEN_ROLES, type UserRole } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { addPersonControl, bangkokInAt } from "@/lib/muster/add-person";
import { addPersonReturnTo } from "@/lib/muster/reopen-return";

const TODAY = "2026-08-06";

function input(over: Partial<Parameters<typeof addPersonControl>[0]> = {}) {
  return {
    date: "2026-08-04",
    todayIso: TODAY,
    dayClosed: false as boolean | null,
    projectId: "11111111-1111-1111-1111-111111111111" as string | null,
    canCorrect: true,
    teamCount: 2,
    ...over,
  };
}

describe("addPersonControl — which arm the panel may offer", () => {
  it("offers the form on an open past day with a project and a team", () => {
    expect(addPersonControl(input())).toEqual({ control: "add" });
  });

  // Today is deliberately ALLOWED. The cockpit is the SA's surface for today, and
  // procurement does not have it — a hole found at 16:00 should not have to wait
  // for midnight.
  it("offers the form for TODAY as well — procurement has no cockpit", () => {
    expect(addPersonControl(input({ date: TODAY }))).toEqual({ control: "add" });
  });

  it("refuses a future date", () => {
    expect(addPersonControl(input({ date: "2026-08-09" }))).toEqual({
      control: "none",
      reason: "future",
    });
  });

  // Permission BEFORE the project and closure arms: their copy tells the reader to
  // do something, and telling a reader who could never act is the
  // affordance-that-is-not-there defect one layer down.
  it("is silent for a reader outside the correction audience", () => {
    expect(addPersonControl(input({ canCorrect: false }))).toEqual({
      control: "none",
      reason: "notPermitted",
    });
    expect(addPersonControl(input({ canCorrect: false, dayClosed: true }))).toEqual({
      control: "none",
      reason: "notPermitted",
    });
  });

  it("asks for a project first — the RPC takes exactly one", () => {
    expect(addPersonControl(input({ projectId: null }))).toEqual({
      control: "none",
      reason: "noProject",
    });
  });

  // muster_correct_session refuses the INSERT path on a closed day by design
  // (U3a's rule, unchanged): reopen first, which every member of this audience
  // can do — pinned as a subset below.
  it("refuses a closed day and the reason is actionable", () => {
    expect(addPersonControl(input({ dayClosed: true }))).toEqual({
      control: "none",
      reason: "closed",
    });
  });

  // A day with NO attendance rows at all is exactly the hole this exists for
  // (08-04 mustered one person), so `dayClosed === null` must NOT be treated the
  // way dayCorrectionControl treats it — there, no rows means nothing to close.
  it("still offers the form on a day with no attendance rows at all", () => {
    expect(addPersonControl(input({ dayClosed: null }))).toEqual({ control: "add" });
  });

  // The message #1000's migration comment predicted. A day with no team has
  // nothing to add a person TO, and the RPC would refuse with `team not found`
  // after the tap.
  it("names the missing team rather than rendering an empty picker", () => {
    expect(addPersonControl(input({ teamCount: 0 }))).toEqual({
      control: "none",
      reason: "noTeams",
    });
  });
});

describe("bangkokInAt — the timestamp the RPC receives", () => {
  // The RPC bounds `in_at` to the row's own Bangkok work date, so an offset-less
  // string would be read as UTC and land on the previous day for any morning
  // time — the row would be refused, or worse, accepted onto the wrong date.
  it("carries the +07:00 offset explicitly", () => {
    expect(bangkokInAt("2026-08-04", "08:00")).toBe("2026-08-04T08:00:00+07:00");
  });

  it("keeps a late evening time on its own date", () => {
    expect(bangkokInAt("2026-08-04", "23:30")).toBe("2026-08-04T23:30:00+07:00");
  });

  it("refuses a malformed date or time rather than guessing", () => {
    expect(bangkokInAt("04/08/2026", "08:00")).toBeNull();
    expect(bangkokInAt("2026-08-04", "8:00")).toBeNull();
    expect(bangkokInAt("2026-08-04", "25:00")).toBeNull();
    expect(bangkokInAt("2026-08-04", "08:60")).toBeNull();
    expect(bangkokInAt("2026-08-04", "")).toBeNull();
  });
});

describe("MUSTER_CORRECT_ROLES", () => {
  // Exhaustive over the role domain, asserting the POSITIVE set exactly: a
  // hand-listed "these may not" test passes green the day an enum value is added
  // AND granted, which is the case the guard exists for.
  it("is exactly the correction audience muster_correct_session gates on", () => {
    const all = Object.keys(USER_ROLE_LABEL) as UserRole[];
    expect(all.filter((r) => MUSTER_CORRECT_ROLES.includes(r)).sort()).toEqual(
      ["procurement", "procurement_manager", "super_admin"].sort(),
    );
  });

  // site_admin holds muster_scan_in, muster_scan_out and the whole cockpit, and
  // is deliberately NOT here: every surface reaching a past day is gated on
  // ATTENDANCE_AUDIT_ROLES, which has no site_admin.
  it("excludes site_admin — she has the cockpit, not this", () => {
    expect(MUSTER_CORRECT_ROLES.includes("site_admin" as UserRole)).toBe(false);
  });

  // The "closed → เปิดวันก่อน" copy tells the reader to reopen. That instruction
  // is only true if every reader who can be told it can actually reopen.
  it("is a SUBSET of MUSTER_REOPEN_ROLES — the closed-day copy depends on it", () => {
    for (const role of MUSTER_CORRECT_ROLES) {
      expect(MUSTER_REOPEN_ROLES.includes(role)).toBe(true);
    }
  });
});

describe("addPersonReturnTo", () => {
  // The fragment bug this module exists for: the panel's own href ends
  // `#d-<date>`, so an outcome appended naively is swallowed by the hash and the
  // banner is dead code.
  it("puts the outcome BEFORE the fragment", () => {
    expect(addPersonReturnTo("/team/attendance?m=2026-08#d-2026-08-04", "ok")).toBe(
      "/team/attendance?m=2026-08&added=1#d-2026-08-04",
    );
  });

  it("carries a refusal code, never a sentence", () => {
    expect(addPersonReturnTo("/team/attendance#d-2026-08-04", "duplicate")).toBe(
      "/team/attendance?addError=duplicate#d-2026-08-04",
    );
  });

  it("refuses an off-app return target", () => {
    expect(addPersonReturnTo("/\\evil.com", "ok")).toBe("/team/attendance?added=1");
  });
});

const TEAMS = [
  { teamId: "aaaaaaaa-0000-0000-0000-000000000001", leadName: "หัวหน้า หนึ่ง", headcount: 3 },
  { teamId: "aaaaaaaa-0000-0000-0000-000000000002", leadName: null, headcount: 0 },
];
const WORKERS = [
  { workerId: "bbbbbbbb-0000-0000-0000-000000000001", name: "ช่าง หนึ่ง" },
  { workerId: "bbbbbbbb-0000-0000-0000-000000000002", name: "ช่าง สอง" },
];

describe("AttendanceAddPersonForm", () => {
  function renderForm(over: Partial<Parameters<typeof AttendanceAddPersonForm>[0]> = {}) {
    render(
      <AttendanceAddPersonForm
        workDate="2026-08-04"
        returnTo="/team/attendance?m=2026-08#d-2026-08-04"
        teams={TEAMS}
        workers={WORKERS}
        {...over}
      />,
    );
    return screen.getByRole("form", { name: /เพิ่มคนที่ตกหล่น/ });
  }

  it("offers every team, labelled by lead and headcount", () => {
    const form = renderForm();
    const team = within(form).getByLabelText(/ทีม/);
    expect(within(team).getByRole("option", { name: /หัวหน้า หนึ่ง/ })).toBeTruthy();
    expect(within(team).getByRole("option", { name: /3 คน/ })).toBeTruthy();
  });

  // An office team has no lead (muster_teams_crew_has_lead binds crew only), and
  // zero exist in production — so a label that assumed a lead would break on the
  // first one created, with every other assertion green.
  it("labels a lead-less team without rendering an empty option", () => {
    const form = renderForm();
    const team = within(form).getByLabelText(/ทีม/);
    const options = within(team).getAllByRole("option");
    for (const option of options) {
      expect(option.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it("carries the date and the return target as hidden fields", () => {
    const form = renderForm();
    expect(form.querySelector('input[name="workDate"]')?.getAttribute("value")).toBe("2026-08-04");
    expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
      "/team/attendance?m=2026-08#d-2026-08-04",
    );
  });

  // The time is REQUIRED and has no default. A pre-filled 08:00 would be a guess
  // the app presents as a record — and the whole reason U4 exists is that a
  // fabricated timestamp is worse than a missing one.
  it("requires a time and pre-fills nothing", () => {
    const form = renderForm();
    const time = within(form).getByLabelText(/เวลาเข้างาน/);
    expect(time.getAttribute("type")).toBe("time");
    expect(time.hasAttribute("required")).toBe(true);
    expect(time.getAttribute("value")).toBeNull();
  });

  it("states that the record is a correction attributed to the person making it", () => {
    const form = renderForm();
    expect(within(form).getByText(/บันทึกเป็นการแก้ไข/)).toBeTruthy();
  });
});
