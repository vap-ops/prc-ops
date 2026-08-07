// Writing failing test first.
//
// Spec 400 U6a — add the fix page's OWN missing person (a single-worker
// variant of AttendanceAddPersonForm, which offers a worker DROPDOWN this page
// has no use for — the worker is fixed by the URL). Reuses
// addMusterPersonFromForm unchanged.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceFixAddForm } from "@/components/features/muster/attendance-fix-add-form";
import type { AddPersonTeam } from "@/components/features/muster/attendance-add-person-form";

const TEAMS: AddPersonTeam[] = [
  { teamId: "11111111-1111-1111-1111-111111111111", leadName: "หัวหน้า หนึ่ง", headcount: 3 },
  { teamId: "22222222-2222-2222-2222-222222222222", leadName: null, headcount: 5 },
];

function renderForm(over: Partial<Parameters<typeof AttendanceFixAddForm>[0]> = {}) {
  render(
    <AttendanceFixAddForm
      workerId="33333333-3333-3333-3333-333333333333"
      workDate="2026-08-04"
      returnTo="/team/attendance/fix?worker=x&date=2026-08-04"
      teams={TEAMS}
      {...over}
    />,
  );
  return screen.getByRole("form");
}

describe("AttendanceFixAddForm", () => {
  it("carries the FIXED worker id as a hidden field — no worker dropdown", () => {
    const form = renderForm();
    expect(form.querySelector('input[name="workerId"]')?.getAttribute("value")).toBe(
      "33333333-3333-3333-3333-333333333333",
    );
    expect(form.querySelector('select[name="workerId"]')).toBeNull();
  });

  it("offers every team, labelled by lead and headcount", () => {
    const form = renderForm();
    const team = within(form).getByLabelText(/ทีม/);
    expect(within(team).getByRole("option", { name: /หัวหน้า หนึ่ง/ })).toBeTruthy();
    expect(within(team).getByRole("option", { name: /ทีมสำนักงาน/ })).toBeTruthy();
  });

  it("requires a time and pre-fills nothing — the same U4 rule", () => {
    const form = renderForm();
    const time = within(form).getByLabelText(/เวลาเข้างาน/);
    expect(time.getAttribute("type")).toBe("time");
    expect(time.hasAttribute("required")).toBe(true);
    expect(time.getAttribute("value")).toBeNull();
  });

  it("carries the work date and return target", () => {
    const form = renderForm();
    expect(form.querySelector('input[name="workDate"]')?.getAttribute("value")).toBe("2026-08-04");
    expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
      "/team/attendance/fix?worker=x&date=2026-08-04",
    );
  });
});
