// Writing failing test first.
//
// Spec 400 U6a — retime ONE existing session. No defaults on either time field
// (a pre-filled guess is worse than an empty one forcing a real value, the same
// rule U4's add form follows), and the out-time field is disabled + explained
// once a HUMAN recorded that check-out (`outTimeLocked`).

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceFixRetimeForm } from "@/components/features/muster/attendance-fix-retime-form";

function renderForm(over: Partial<Parameters<typeof AttendanceFixRetimeForm>[0]> = {}) {
  render(
    <AttendanceFixRetimeForm
      teamId="11111111-1111-1111-1111-111111111111"
      workerId="22222222-2222-2222-2222-222222222222"
      session="regular"
      workDate="2026-08-04"
      returnTo="/team/attendance/fix?worker=x&date=2026-08-04"
      currentInAt="2026-08-04T01:00:00Z"
      currentOutAt={null}
      outLocked={false}
      {...over}
    />,
  );
  return screen.getByRole("form");
}

describe("AttendanceFixRetimeForm", () => {
  it("carries the team, worker, session and work date as hidden fields", () => {
    const form = renderForm();
    expect(form.querySelector('input[name="teamId"]')?.getAttribute("value")).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(form.querySelector('input[name="workerId"]')?.getAttribute("value")).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(form.querySelector('input[name="session"]')?.getAttribute("value")).toBe("regular");
    expect(form.querySelector('input[name="workDate"]')?.getAttribute("value")).toBe("2026-08-04");
    expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
      "/team/attendance/fix?worker=x&date=2026-08-04",
    );
  });

  it("pre-fills NEITHER time field — a guessed timestamp is worse than an empty one", () => {
    const form = renderForm();
    const inTime = within(form).getByLabelText(/เวลาเข้างานใหม่/);
    const outTime = within(form).getByLabelText(/เวลาออกงานใหม่/);
    expect(inTime.getAttribute("type")).toBe("time");
    expect(inTime.getAttribute("value")).toBeNull();
    expect(outTime.getAttribute("type")).toBe("time");
    expect(outTime.getAttribute("value")).toBeNull();
  });

  it("neither time field is required — a corrector may change just one", () => {
    const form = renderForm();
    expect(
      within(form)
        .getByLabelText(/เวลาเข้างานใหม่/)
        .hasAttribute("required"),
    ).toBe(false);
    expect(
      within(form)
        .getByLabelText(/เวลาออกงานใหม่/)
        .hasAttribute("required"),
    ).toBe(false);
  });

  it("shows the CURRENT recorded times as facts, not as input defaults", () => {
    const form = renderForm({
      currentInAt: "2026-08-04T01:15:00Z",
      currentOutAt: "2026-08-04T10:30:00Z",
    });
    expect(within(form).getByText(/ปัจจุบัน/)).toBeTruthy();
  });

  it("leaves the out-time field enabled and undisclosed when it is NOT locked", () => {
    const form = renderForm({ outLocked: false });
    expect(
      within(form)
        .getByLabelText(/เวลาออกงานใหม่/)
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(within(form).queryByText(/บันทึกโดยคนแล้ว/)).toBeNull();
  });

  it("disables and discloses the out-time field once a HUMAN recorded it", () => {
    const form = renderForm({ outLocked: true, currentOutAt: "2026-08-04T10:30:00Z" });
    expect(
      within(form)
        .getByLabelText(/เวลาออกงานใหม่/)
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(within(form).getByText(/บันทึกโดยคนแล้ว/)).toBeTruthy();
  });

  it("labels an OT session distinctly from a regular one", () => {
    renderForm({ session: "ot" });
    expect(screen.getByText(/^OT$/)).toBeTruthy();
  });
});
