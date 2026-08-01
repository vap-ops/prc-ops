// Spec 388 U4 — the ช่าง's attendance month grid.
//
// The grid answers "how many days did I work / where are my gaps" at a glance;
// the sessions stay one tap down, where U2's honesty rules still apply (no
// verdict on a manual row, none on OT, ปิดอัตโนมัติ marked, open day left open).
//
// The load-bearing assertions here are the ones about what a CELL may claim:
// a day is only painted late when a regular QR session was late, so a manual
// row cannot colour a worker's calendar.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkerAttendanceMonth } from "@/components/features/portal/worker-attendance-month";
import {
  buildAttendanceMonthView,
  type AttendanceSessionInput,
} from "@/lib/attendance/attendance-sessions";
import { ATTENDANCE_LATE_LABEL, ATTENDANCE_MANUAL_NOTE } from "@/lib/i18n/labels";

const JULY = "2026-07-01";

function row(over: Partial<AttendanceSessionInput> = {}): AttendanceSessionInput {
  return {
    work_date: "2026-07-15",
    session: "regular",
    in_at: "2026-07-15T01:00:00+00:00", // 08:00 Bangkok
    in_method: "qr",
    out_at: "2026-07-15T10:00:00+00:00", // 17:00 Bangkok
    out_method: "qr",
    out_auto: false,
    ot_hours: 0,
    project_name: "TFM นายาว เพชรบูรณ์",
    ...over,
  };
}

function renderMonth(rows: AttendanceSessionInput[]) {
  return render(
    <WorkerAttendanceMonth
      view={buildAttendanceMonthView({ rows, monthAnchor: JULY })}
      prevHref="/technician/history?m=2026-06"
      nextHref="/technician/history?m=2026-08"
    />,
  );
}

describe("WorkerAttendanceMonth", () => {
  it("labels the month in Buddhist era and offers both directions of nav", () => {
    renderMonth([row()]);
    // Scoped: the day-detail heading also carries the BE year, so an unscoped
    // /2569/ matches two nodes and would pass or fail for the wrong reason.
    expect(screen.getByTestId("attendance-month-label")).toHaveTextContent("2569");
    expect(screen.getByRole("link", { name: /เดือนก่อน/ })).toHaveAttribute(
      "href",
      "/technician/history?m=2026-06",
    );
    expect(screen.getByRole("link", { name: /เดือนถัดไป/ })).toHaveAttribute(
      "href",
      "/technician/history?m=2026-08",
    );
  });

  it("makes a worked day tappable and leaves an empty day inert", () => {
    renderMonth([row({ work_date: "2026-07-15" })]);
    expect(screen.getByRole("button", { name: /15/ })).toBeInTheDocument();
    // 16 July has no rows — it must not be a control at all.
    expect(screen.queryByRole("button", { name: /^16$/ })).not.toBeInTheDocument();
  });

  it("opens the most recent worked day by default, so the page is never blank", () => {
    renderMonth([
      row({ work_date: "2026-07-10" }),
      row({ work_date: "2026-07-20", in_at: "2026-07-20T01:05:00+00:00" }),
    ]);
    const detail = screen.getByTestId("attendance-day-detail");
    expect(within(detail).getByText("08:05")).toBeInTheDocument();
  });

  it("shows the tapped day's sessions, including both of a day that has OT", async () => {
    const user = userEvent.setup();
    renderMonth([
      row({ work_date: "2026-07-10" }),
      row({
        work_date: "2026-07-10",
        session: "ot",
        in_at: "2026-07-10T10:25:00+00:00",
        out_at: "2026-07-10T13:30:00+00:00",
        ot_hours: 3,
      }),
      row({ work_date: "2026-07-20" }),
    ]);
    await user.click(screen.getByRole("button", { name: /10/ }));
    const detail = screen.getByTestId("attendance-day-detail");
    expect(within(detail).getAllByRole("listitem")).toHaveLength(2);
  });

  it("paints a day late only for a regular QR session", async () => {
    const user = userEvent.setup();
    renderMonth([row({ work_date: "2026-07-15", in_at: "2026-07-15T01:31:00+00:00" })]);
    const day = screen.getByRole("button", { name: /15/ });
    expect(day).toHaveAttribute("data-late", "true");
    await user.click(day);
    expect(
      within(screen.getByTestId("attendance-day-detail")).getByText(ATTENDANCE_LATE_LABEL),
    ).toBeInTheDocument();
  });

  it("never paints a day late off a manual row — the SA's tap is not the arrival", async () => {
    const user = userEvent.setup();
    renderMonth([
      row({ work_date: "2026-07-15", in_at: "2026-07-15T01:31:00+00:00", in_method: "manual" }),
    ]);
    const day = screen.getByRole("button", { name: /15/ });
    expect(day).toHaveAttribute("data-late", "false");
    await user.click(day);
    const detail = screen.getByTestId("attendance-day-detail");
    expect(within(detail).queryByText(ATTENDANCE_LATE_LABEL)).not.toBeInTheDocument();
    expect(within(detail).getByText(ATTENDANCE_MANUAL_NOTE)).toBeInTheDocument();
  });

  it("marks a day carrying OT", () => {
    renderMonth([row({ work_date: "2026-07-15", session: "ot", ot_hours: 3 })]);
    expect(screen.getByRole("button", { name: /15/ })).toHaveAttribute("data-ot", "true");
  });

  it("shows a month with no record as an empty state, not a bare grid", () => {
    renderMonth([]);
    expect(screen.getByText(/ยังไม่มีประวัติ/)).toBeInTheDocument();
    expect(screen.queryByTestId("attendance-day-detail")).not.toBeInTheDocument();
  });
});
