// Spec 388 U2 — the ช่าง's own attendance list.
//
// What these pin, beyond "it renders": the three cases where the surface makes a
// CLAIM ABOUT A PERSON and must not overstate it —
//   * a manual row shows no verdict and says who recorded it;
//   * an auto-closed check-out is marked as such (it is not a departure the
//     worker made);
//   * an open day shows no out time rather than inventing one.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkerAttendanceList } from "@/components/features/portal/worker-attendance-list";
import {
  buildAttendanceSessions,
  type AttendanceSessionInput,
} from "@/lib/attendance/attendance-sessions";
import {
  ATTENDANCE_AUTO_CLOSED_NOTE,
  ATTENDANCE_LATE_LABEL,
  ATTENDANCE_MANUAL_NOTE,
  ATTENDANCE_ON_TIME_LABEL,
  ATTENDANCE_OT_SESSION_LABEL,
} from "@/lib/i18n/labels";

const TODAY = "2026-08-01";

function row(over: Partial<AttendanceSessionInput> = {}): AttendanceSessionInput {
  return {
    work_date: "2026-07-31",
    session: "regular",
    in_at: "2026-07-31T01:00:00+00:00", // 08:00 Bangkok
    in_method: "qr",
    out_at: "2026-07-31T10:00:00+00:00", // 17:00 Bangkok
    out_method: "qr",
    out_auto: false,
    ot_hours: 0,
    project_name: "TFM นายาว เพชรบูรณ์",
    ...over,
  };
}

function renderRows(rows: AttendanceSessionInput[]) {
  return render(
    <WorkerAttendanceList built={buildAttendanceSessions({ rows, todayIso: TODAY })} />,
  );
}

/**
 * Verdict assertions MUST be scoped to the list. The summary tiles reuse the
 * same vocabulary (ตรงเวลา / สาย / ล่วงเวลา — one term per concept, per the
 * UI-term SSOT rule) and render unconditionally, so an unscoped
 * queryByText(สาย) matches the summary label even when no row is late and would
 * pass for entirely the wrong reason.
 */
const list = () => within(screen.getByTestId("attendance-rows"));

describe("WorkerAttendanceList", () => {
  it("shows the check-in and check-out wall clock for a normal day", () => {
    renderRows([row()]);
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("17:00")).toBeInTheDocument();
  });

  it("marks a late QR check-in", () => {
    renderRows([row({ in_at: "2026-07-31T01:31:00+00:00" })]); // 08:31 Bangkok
    expect(list().getByText(ATTENDANCE_LATE_LABEL)).toBeInTheDocument();
    expect(list().queryByText(ATTENDANCE_ON_TIME_LABEL)).not.toBeInTheDocument();
  });

  it("never accuses a manually-entered row — no verdict, and it names who recorded it", () => {
    // 08:31 Bangkok: past the cutoff, so ONLY the manual method can be
    // suppressing the verdict.
    renderRows([row({ in_at: "2026-07-31T01:31:00+00:00", in_method: "manual" })]);
    expect(list().queryByText(ATTENDANCE_LATE_LABEL)).not.toBeInTheDocument();
    expect(list().queryByText(ATTENDANCE_ON_TIME_LABEL)).not.toBeInTheDocument();
    expect(list().getByText(ATTENDANCE_MANUAL_NOTE)).toBeInTheDocument();
  });

  it("gives an OT session its own label and no verdict", () => {
    renderRows([
      row({ session: "ot", in_at: "2026-07-31T10:25:00+00:00", ot_hours: 3, out_at: null }),
    ]);
    expect(list().getByText(ATTENDANCE_OT_SESSION_LABEL)).toBeInTheDocument();
    expect(list().queryByText(ATTENDANCE_LATE_LABEL)).not.toBeInTheDocument();
    expect(list().queryByText(ATTENDANCE_ON_TIME_LABEL)).not.toBeInTheDocument();
  });

  it("marks an auto-closed check-out rather than presenting it as a departure", () => {
    renderRows([row({ out_auto: true })]);
    expect(screen.getByText(ATTENDANCE_AUTO_CLOSED_NOTE)).toBeInTheDocument();
  });

  it("leaves an open day without an out time instead of inventing one", () => {
    renderRows([row({ out_at: null, out_method: null })]);
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.queryByText("17:00")).not.toBeInTheDocument();
    expect(screen.queryByText(ATTENDANCE_AUTO_CLOSED_NOTE)).not.toBeInTheDocument();
  });

  it("renders one entry per session, so a day with OT shows both", () => {
    renderRows([
      row({ work_date: "2026-07-30" }),
      row({
        work_date: "2026-07-30",
        session: "ot",
        in_at: "2026-07-30T10:25:00+00:00",
        out_at: "2026-07-30T13:30:00+00:00",
        ot_hours: 3,
      }),
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("summarises the window: days, on time, late, OT", () => {
    renderRows([
      row({ work_date: "2026-08-01", in_at: "2026-08-01T01:05:00+00:00" }), // on time
      row({ work_date: "2026-07-31", in_at: "2026-07-31T01:31:00+00:00" }), // late
      row({ work_date: "2026-07-30", session: "ot", ot_hours: 3 }),
    ]);
    const summary = screen.getByTestId("attendance-summary");
    // 3 distinct days, 1 on time, 1 late, 1 OT session.
    expect(within(summary).getByTestId("summary-days")).toHaveTextContent("3");
    expect(within(summary).getByTestId("summary-on-time")).toHaveTextContent("1");
    expect(within(summary).getByTestId("summary-late")).toHaveTextContent("1");
    expect(within(summary).getByTestId("summary-ot")).toHaveTextContent("1");
  });

  it("shows an empty state, not a bare page, when there is no record", () => {
    renderRows([]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/ยังไม่มีประวัติ/)).toBeInTheDocument();
  });
});
