// Spec 397 U3 — the reopen affordance on the attendance audit report.
//
// A closed muster day is final: muster_undo_scan refuses against a closure, and
// close_muster_day books wages inline. reopen_muster_day is the way back, and
// this is the surface that offers it — on the DAY header of the drill, because
// closure is a project-day fact (the drill already prints it there).
//
// Three things are pinned:
//   1. the role set matches the RPC's allowlist exactly (a button its own server
//      refuses is the affordance-then-refuse defect this repo keeps re-learning);
//   2. the form only exists on a CLOSED day, and only for a permitted role;
//   3. the reason is REQUIRED at the input, not merely at the RPC — the RPC's
//      refusal would otherwise be the user's first hint that it is mandatory.

import { readFileSync } from "node:fs";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceDrill } from "@/components/features/muster/attendance-drill";
import { MUSTER_REOPEN_ROLES, type UserRole } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { groupDetailByDate, type AttendanceDetailRow } from "@/lib/muster/attendance-audit";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

function row(over: Partial<AttendanceDetailRow> = {}): AttendanceDetailRow {
  return {
    workerId: "w1",
    workerName: "ช่าง หนึ่ง",
    projectId: "p1",
    projectName: "โครงการเอ",
    workDate: "2026-08-04",
    session: "regular",
    inTime: "08:22",
    outTime: "17:00",
    inMethod: "manual",
    outMethod: null,
    outAuto: false,
    otHours: null,
    stillIn: false,
    outNextDay: false,
    scannedByName: "ผู้ดูแลระบบ",
    teamLeadName: "หัวหน้า",
    dayClosed: true,
    ...over,
  } as AttendanceDetailRow;
}

const TODAY = "2026-08-05";

describe("spec 397 U3 — who may reopen", () => {
  it("is exactly the roles that may CLOSE, plus procurement", () => {
    const all = Object.keys(USER_ROLE_LABEL) as UserRole[];
    expect(all.filter((r) => MUSTER_REOPEN_ROLES.includes(r)).sort()).toEqual(
      ["procurement", "procurement_manager", "site_admin", "super_admin"].sort(),
    );
  });

  it("excludes the roles that only READ the report", () => {
    // accounting/hr audit attendance and must never edit the muster; a PM cannot
    // close a day either, so it cannot un-close one.
    for (const role of ["accounting", "hr", "project_manager", "project_director"] as const) {
      expect(MUSTER_REOPEN_ROLES).not.toContain(role);
    }
  });
});

describe("spec 397 U3 — the reopen form on the day header", () => {
  it("offers reopen on a CLOSED day for a permitted role", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row()])}
        todayIso={TODAY}
        canReopen
        backHref="/team"
      />,
    );
    const form = screen.getByRole("form", { name: /เปิดวัน/ });
    expect(within(form).getByLabelText(/เหตุผล/)).toBeRequired();
    expect(within(form).getByRole("button", { name: /เปิดวันอีกครั้ง/ })).toBeInTheDocument();
    // The two facts the action needs, carried as hidden fields — the day header
    // is the only place that knows WHICH project-day this is.
    expect(form.querySelector('input[name="projectId"]')).toHaveValue("p1");
    expect(form.querySelector('input[name="workDate"]')).toHaveValue("2026-08-04");
  });

  it("offers nothing on an OPEN day — there is nothing to reopen", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row({ dayClosed: false })])}
        todayIso={TODAY}
        canReopen
        backHref="/team"
      />,
    );
    expect(screen.queryByRole("form", { name: /เปิดวัน/ })).not.toBeInTheDocument();
  });

  it("offers nothing to a role that may not reopen, even on a closed day", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row()])}
        todayIso={TODAY}
        canReopen={false}
        backHref="/team"
      />,
    );
    expect(screen.queryByRole("form", { name: /เปิดวัน/ })).not.toBeInTheDocument();
    // …and the day still reads as closed: withholding the CONTROL must not
    // withhold the FACT.
    expect(screen.getByText(/ปิดวันแล้ว/)).toBeInTheDocument();
  });

  it("says what reopening does — it does not silently re-open a wage-relevant day", () => {
    render(
      <AttendanceDrill
        days={groupDetailByDate([row()])}
        todayIso={TODAY}
        canReopen
        backHref="/team"
      />,
    );
    // The correction loop is reopen → fix → close again; a user who stops after
    // step 1 leaves the day underived, which is exactly the state the report
    // already flags as ยังไม่ได้ปิด.
    expect(screen.getByText(/ปิดวันใหม่/)).toBeInTheDocument();
  });
});

describe("spec 397 U3 — the day carries its project id", () => {
  it("groupDetailByDate keeps projectId, not just the name", () => {
    const [day] = groupDetailByDate([row()]);
    expect(day?.projectId).toBe("p1");
  });
});

describe("spec 397 U3 — the action", () => {
  const src = strip(readFileSync("src/app/team/attendance/actions.ts", "utf8"));

  it("gates on the same set the RPC does, by importing it — never a literal", () => {
    expect(count(src, "MUSTER_REOPEN_ROLES")).toBeGreaterThanOrEqual(2);
    expect(src).not.toContain('"procurement_manager"');
  });

  it("calls the RPC and revalidates the report", () => {
    expect(count(src, '"reopen_muster_day"')).toBe(1);
    expect(count(src, "revalidatePath")).toBeGreaterThanOrEqual(2);
  });

  it("refuses a blank reason before it reaches the database", () => {
    expect(src).toContain("trim()");
  });
});
