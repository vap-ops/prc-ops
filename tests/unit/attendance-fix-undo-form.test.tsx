// Writing failing test first.
//
// Spec 400 U6a — delete ONE session (`muster_undo_scan`). No confirmation
// checkbox unlike ปิดวัน: this touches one row, not the whole day's wages, and
// the RPC itself refuses once wages are booked or the day is closed.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttendanceFixUndoForm } from "@/components/features/muster/attendance-fix-undo-form";

function renderForm(over: Partial<Parameters<typeof AttendanceFixUndoForm>[0]> = {}) {
  render(
    <AttendanceFixUndoForm
      workerId="22222222-2222-2222-2222-222222222222"
      workDate="2026-08-04"
      session="regular"
      returnTo="/team/attendance/fix?worker=x&date=2026-08-04"
      {...over}
    />,
  );
  return screen.getByRole("form");
}

describe("AttendanceFixUndoForm", () => {
  it("carries the worker, session and work date as hidden fields — NO team id", () => {
    const form = renderForm();
    expect(form.querySelector('input[name="workerId"]')?.getAttribute("value")).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(form.querySelector('input[name="workDate"]')?.getAttribute("value")).toBe("2026-08-04");
    expect(form.querySelector('input[name="session"]')?.getAttribute("value")).toBe("regular");
    expect(form.querySelector('input[name="teamId"]')).toBeNull();
  });

  it("carries the return target", () => {
    const form = renderForm();
    expect(form.querySelector('input[name="returnTo"]')?.getAttribute("value")).toBe(
      "/team/attendance/fix?worker=x&date=2026-08-04",
    );
  });

  it("renders one submit control, labelled by session", () => {
    renderForm({ session: "ot" });
    expect(screen.getByRole("button", { name: /ลบการเช็คชื่อ OT/ })).toBeTruthy();
  });
});
