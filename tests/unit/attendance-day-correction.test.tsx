// Spec 400 U3b — the ?day= panel: the COLUMN twin of the ?worker= drill.
//
// U1 made the grid the default view, and the grid carries no correction control
// at all — the reopen form shipped by spec 397 U3 lives inside the LIST's drill.
// So the default view of the report showed procurement every hole and offered
// them nothing. U3a then widened `close_muster_day` and `muster_scan_in` to
// `procurement`, which made two of this page's sentences FALSE: they still hand
// the close step to the SA.
//
// What is pinned here:
//   1. the control the panel offers is a PURE function of (date, closure,
//      project, permissions) — extracted because a source scan proves a branch
//      exists, never that it is reachable (U1's surviving mutant);
//   2. every arm renders its own message, so a refusal names its cause rather
//      than silently rendering nothing;
//   3. MUSTER_CLOSE_ROLES mirrors `close_muster_day`'s LIVE allowlist over the
//      exhaustive role domain, and MUSTER_REOPEN_ROLES ⊆ it — the implication the
//      "แก้ไขแล้วต้องปิดวันใหม่" copy rests on.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceDayPanel } from "@/components/features/muster/attendance-day-panel";
import { MUSTER_CLOSE_ROLES, MUSTER_REOPEN_ROLES, type UserRole } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { attendanceDayParam, dayCorrectionControl } from "@/lib/muster/day-correction";
import { closeReturnTo } from "@/lib/muster/reopen-return";
import type { GridDay } from "@/lib/muster/attendance-grid";

const TODAY = "2026-08-06";
const DATES = ["2026-08-04", "2026-08-05", "2026-08-06"];

function day(over: Partial<GridDay> = {}): GridDay {
  return {
    date: "2026-08-04",
    nonWorking: false,
    holidayName: null,
    headcount: 4,
    dayClosed: false,
    ...over,
  };
}

describe("spec 400 U3b — who may close a muster day", () => {
  it("is exactly close_muster_day's live allowlist, over the whole role domain", () => {
    // Read from the LIVE function 2026-08-06 (migration 20260813075912 widened it):
    //   {site_admin, super_admin, procurement_manager, procurement}
    // Iterating the exhaustive domain, not a hand-typed "these must not" list: a
    // role added to the enum later must red this, not sail through it.
    const all = Object.keys(USER_ROLE_LABEL) as UserRole[];
    expect(all.filter((r) => MUSTER_CLOSE_ROLES.includes(r)).sort()).toEqual(
      ["procurement", "procurement_manager", "site_admin", "super_admin"].sort(),
    );
  });

  it("admits every role that may REOPEN — the implication the loop copy rests on", () => {
    // "แก้ไขแล้วต้องปิดวันใหม่" is only honest while a reopener can also close.
    // The two sets gate two different RPCs and are kept distinct per the role
    // doctrine, so the relationship between them is pinned rather than assumed:
    // narrowing close would otherwise leave the reopen form promising a step its
    // reader cannot take, silently.
    for (const role of MUSTER_REOPEN_ROLES) {
      expect(MUSTER_CLOSE_ROLES).toContain(role);
    }
  });
});

describe("spec 400 U3b — dayCorrectionControl", () => {
  const base = {
    date: "2026-08-04",
    todayIso: TODAY,
    dayClosed: false as boolean | null,
    projectId: "p1" as string | null,
    canReopen: true,
    canClose: true,
  };

  it("offers CLOSE on an open day", () => {
    expect(dayCorrectionControl(base)).toEqual({ control: "close" });
  });

  it("offers REOPEN on a closed day", () => {
    expect(dayCorrectionControl({ ...base, dayClosed: true })).toEqual({ control: "reopen" });
  });

  it("offers nothing for a day that has not happened yet", () => {
    expect(dayCorrectionControl({ ...base, date: "2026-08-09" })).toEqual({
      control: "none",
      reason: "future",
    });
  });

  it("offers nothing for a day nobody was scanned on", () => {
    // dayClosed === null is the grid's "this day carries no rows at all". Closing
    // it would insert a closure over nothing, and the correction that WOULD help
    // — adding the missing person — needs a back-dated in_at that no RPC accepts
    // today (spec 400 U3b finding 2).
    expect(dayCorrectionControl({ ...base, dayClosed: null })).toEqual({
      control: "none",
      reason: "noRecords",
    });
  });

  it("asks for a project before offering either write", () => {
    // close_muster_day and reopen_muster_day both take ONE p_project; a column of
    // the ทุกโครงการ grid spans several, so there is no single target to name.
    expect(dayCorrectionControl({ ...base, projectId: null })).toEqual({
      control: "none",
      reason: "noProject",
    });
    expect(dayCorrectionControl({ ...base, projectId: null, dayClosed: true })).toEqual({
      control: "none",
      reason: "noProject",
    });
  });

  it("withholds the control from a role the RPC refuses — per RPC, not in general", () => {
    // The two permissions are separate inputs because they mirror two separate
    // allowlists. A reader who may close but not reopen must still be offered the
    // close on an open day.
    expect(dayCorrectionControl({ ...base, canClose: false })).toEqual({
      control: "none",
      reason: "notPermitted",
    });
    expect(dayCorrectionControl({ ...base, dayClosed: true, canReopen: false })).toEqual({
      control: "none",
      reason: "notPermitted",
    });
    expect(dayCorrectionControl({ ...base, canReopen: false })).toEqual({ control: "close" });
    expect(dayCorrectionControl({ ...base, dayClosed: true, canClose: false })).toEqual({
      control: "reopen",
    });
  });

  it("puts permission ahead of the project prompt", () => {
    // Telling accounting to pick a project would advertise a write it can never
    // perform; the prompt is only actionable for a reader who may act.
    expect(
      dayCorrectionControl({ ...base, projectId: null, canReopen: false, canClose: false }),
    ).toEqual({ control: "none", reason: "notPermitted" });
  });
});

describe("spec 400 U3b — attendanceDayParam", () => {
  it("accepts a date the grid actually drew", () => {
    expect(attendanceDayParam("2026-08-05", DATES)).toBe("2026-08-05");
  });

  it("rejects a date outside the rendered range", () => {
    // Mirrors attendanceWorkerId: an unvalidated value would reach the panel and
    // describe a column that is not on screen.
    expect(attendanceDayParam("2026-01-01", DATES)).toBeNull();
  });

  it("rejects a repeated key and a missing one", () => {
    expect(attendanceDayParam(["2026-08-05", "2026-08-04"], DATES)).toBeNull();
    expect(attendanceDayParam(undefined, DATES)).toBeNull();
  });
});

describe("spec 400 U3b — the panel", () => {
  const props = {
    todayIso: TODAY,
    projectId: "p1",
    canReopen: true,
    canClose: true,
    returnTo: "/team/attendance?start=2026-08-01&end=2026-08-06",
  };

  it("offers the close form on an open day, carrying the project-day it names", () => {
    render(<AttendanceDayPanel day={day()} {...props} />);
    const form = screen.getByRole("form", { name: /ปิดวัน/ });
    expect(form.querySelector('input[name="projectId"]')).toHaveValue("p1");
    expect(form.querySelector('input[name="workDate"]')).toHaveValue("2026-08-04");
    expect(within(form).getByRole("button", { name: /ปิดวัน/ })).toBeInTheDocument();
  });

  it("says what closing DOES — it books the day's wages", () => {
    render(<AttendanceDayPanel day={day()} {...props} />);
    expect(screen.getByText(/ค่าแรง/)).toBeInTheDocument();
  });

  it("offers the reopen form on a closed day, with the reason required at the input", () => {
    render(<AttendanceDayPanel day={day({ dayClosed: true })} {...props} />);
    const form = screen.getByRole("form", { name: /เปิดวัน/ });
    expect(within(form).getByLabelText(/เหตุผล/)).toBeRequired();
    expect(screen.queryByRole("form", { name: /^ปิดวัน/ })).not.toBeInTheDocument();
  });

  // Each of these arms REPLACES a control, so what is pinned is the presence of
  // the new message — not merely the absence of the form, which an empty render
  // satisfies perfectly. One case each: three renders in one test share a DOM,
  // so a later assertion can pass on an earlier render's output.
  it("names the cause on a day nobody was scanned", () => {
    render(<AttendanceDayPanel day={day({ dayClosed: null, headcount: 0 })} {...props} />);
    expect(screen.getByText("ยังไม่มีบันทึกการเช็คชื่อในวันนี้")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("asks for a project rather than offering a write with no target", () => {
    render(<AttendanceDayPanel day={day()} {...props} projectId={null} />);
    expect(screen.getByText(/เลือกโครงการ/)).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("names the cause on a day that has not happened yet", () => {
    render(<AttendanceDayPanel day={day({ date: "2026-08-09" })} {...props} />);
    expect(screen.getByText(/ยังมาไม่ถึง/)).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("says nothing at all to a reader who may not act — silence, not a telling-off", () => {
    // notPermitted is the one `none` arm with no copy: the header above already
    // carries the day's state, and accounting does not need to be informed that
    // it may not close muster days.
    render(<AttendanceDayPanel day={day()} {...props} canReopen={false} canClose={false} />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByText(/เลือกโครงการ/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ยังมาไม่ถึง/)).not.toBeInTheDocument();
    // …and the FACT survives.
    expect(screen.getByText(/4 คน/)).toBeInTheDocument();
  });

  it("keeps the FACT when it withholds the CONTROL", () => {
    // Spec 397 U3's rule: a reader who may not act still gets the day's state.
    render(<AttendanceDayPanel day={day({ dayClosed: true })} {...props} canReopen={false} />);
    expect(screen.queryByRole("form", { name: /เปิดวัน/ })).not.toBeInTheDocument();
    expect(screen.getByText(/ปิดวันแล้ว/)).toBeInTheDocument();
    expect(screen.getByText(/4 คน/)).toBeInTheDocument();
  });
});

describe("spec 400 U3b — where the close form returns to", () => {
  const GRID = "/team/attendance?start=2026-08-01&end=2026-08-06&day=2026-08-04#d-2026-08-04";

  it("puts the outcome in the QUERY, before any fragment", () => {
    // The same defect reopen shipped in review: the panel's own href ends in a
    // fragment, so a naively appended param is swallowed by the hash and the
    // banner becomes dead code.
    const url = new URL(closeReturnTo(GRID, "ok"), "http://x");
    expect(url.searchParams.get("closed")).toBe("1");
    expect(url.hash).toBe("#d-2026-08-04");
    expect(url.searchParams.get("day")).toBe("2026-08-04");
  });

  it("carries a refusal as a CODE, never a sentence", () => {
    const url = new URL(closeReturnTo(GRID, "denied"), "http://x");
    expect(url.searchParams.get("closeError")).toBe("denied");
    expect(url.hash).toBe("#d-2026-08-04");
  });

  it("refuses an off-app returnTo — including the backslash form", () => {
    for (const bad of ["/\\evil.com", "//evil.com", "https://evil.com", "javascript:alert(1)"]) {
      expect(closeReturnTo(bad, "ok")).toBe("/team/attendance?closed=1");
    }
    expect(closeReturnTo(undefined, "ok")).toBe("/team/attendance?closed=1");
  });
});
