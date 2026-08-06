// Spec 400 U1 — the grid's rendering rules.
//
// The page is a Server Component, so with this markup inline NOTHING would pin
// the Thai strings, the shading, or the link idiom — the exact reason spec 358
// U3 extracted its drill after three review findings were invisible to a 5,100-
// test suite. Presentational component, rendered here for real.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttendanceGridView } from "@/components/features/muster/attendance-grid-view";
import { buildAttendanceGrid, type AttendanceGridInput } from "@/lib/muster/attendance-grid";
import type { AttendanceDetailRow } from "@/lib/muster/attendance-audit";

function row(over: Partial<AttendanceDetailRow> = {}): AttendanceDetailRow {
  const workDate = over.workDate ?? "2026-08-03";
  return {
    workerId: "w1",
    workerName: "สมชาย",
    projectId: "p1",
    projectName: "TFM โพธิ์ทอง",
    workDate,
    session: "regular",
    inAt: `${workDate}T01:00:00+00:00`,
    inTime: "08:00",
    inMethod: "qr",
    outAt: `${workDate}T10:00:00+00:00`,
    outTime: "17:00",
    outMethod: "qr",
    outAuto: false,
    otHours: null,
    scannedBy: "u1",
    scannedByName: "อรปรีญา",
    teamLeadName: "หัวหน้า",
    dayClosed: false,
    stillIn: false,
    outNextDay: false,
    ...over,
  };
}

function grid(over: Partial<AttendanceGridInput> = {}) {
  return buildAttendanceGrid({
    from: "2026-08-03",
    to: "2026-08-05",
    rows: [row()],
    holidays: [],
    ...over,
  });
}

function renderGrid(
  over: Partial<AttendanceGridInput> = {},
  workerHref: ((id: string) => string) | null = null,
) {
  return render(
    <AttendanceGridView grid={grid(over)} todayIso="2026-08-05" workerHref={workerHref} />,
  );
}

describe("AttendanceGridView", () => {
  it("renders one column per day and shows the check-in time in the cell", () => {
    renderGrid();
    expect(screen.getAllByRole("columnheader")).toHaveLength(4); // ช่าง + 3 days
    expect(screen.getByText("08:00")).toBeInTheDocument();
  });

  it("puts the day's headcount on the COLUMN, never on a worker cell", () => {
    // The project-day fact repeated per worker is N findings against N people
    // (spec 358 U2) — 41× worse in a grid.
    renderGrid({
      rows: [row({ workerId: "a", workerName: "ก" }), row({ workerId: "b", workerName: "ข" })],
    });
    const header = screen.getAllByRole("columnheader")[1];
    expect(header).toHaveTextContent("2");
  });

  it("shades a Sunday and names a holiday, so an empty column there is not a finding", () => {
    renderGrid({
      from: "2026-08-02", // Sunday
      to: "2026-08-04",
      rows: [row({ workDate: "2026-08-03" })],
      holidays: [{ holiday_date: "2026-08-04", name_th: "วันหยุดทดสอบ" }],
    });
    expect(screen.getByText("วันหยุดทดสอบ")).toBeInTheDocument();
    const sunday = screen.getAllByRole("columnheader")[1];
    expect(sunday?.className).toContain("bg-sunk");
  });

  it("marks a cell that carries a finding and names every one of them", () => {
    renderGrid({
      rows: [row({ inMethod: "manual", outAt: null, outTime: null, stillIn: true })],
    });
    // Past day (range ends 08-05, the cell is 08-03) ⇒ the honest wording is the
    // finding one, matching openSessionLabel rather than re-deriving it.
    const cell = screen.getByLabelText(/บันทึกมือ/);
    expect(cell).toHaveAccessibleName(expect.stringContaining("ยังไม่เช็คออก"));
  });

  it("softens an open check-out to ยังอยู่ในงาน on TODAY's column", () => {
    // Mid-shift there is no auto-out cron, so every worker on site today has a
    // null out_at. Calling that a finding flags the whole crew every morning.
    renderGrid({
      rows: [row({ workDate: "2026-08-05", outAt: null, outTime: null, stillIn: true })],
    });
    const cell = screen.getByLabelText(/ยังอยู่ในงาน/);
    expect(cell).toBeInTheDocument();
    expect(screen.queryByLabelText(/ยังไม่เช็คออก/)).toBeNull();
  });

  it("leaves a clean cell unmarked", () => {
    const { container } = renderGrid();
    expect(container.querySelectorAll("td .bg-attn")).toHaveLength(0);
  });

  it("marks exactly the cells that carry a finding", () => {
    renderGrid({
      rows: [
        row({ workerId: "a", workerName: "ก", workDate: "2026-08-03" }),
        row({ workerId: "a", workerName: "ก", workDate: "2026-08-04", inMethod: "manual" }),
      ],
    });
    expect(document.querySelectorAll("td .bg-attn")).toHaveLength(1);
  });

  it("links the worker name to their calendar only when the viewer may open it", () => {
    renderGrid({}, (id) => `/workers/${id}/attendance?from=/team/attendance`);
    expect(screen.getByRole("link", { name: /สมชาย/ })).toHaveAttribute(
      "href",
      "/workers/w1/attendance?from=/team/attendance",
    );
  });

  it("renders the worker name as plain text when the viewer may NOT", () => {
    // ATTENDANCE_AUDIT_ROLES is wider than WORKER_ROSTER_ROLES: accounting, hr
    // and project_coordinator read this report and would hit a redirect.
    renderGrid({}, null);
    expect(screen.queryByRole("link", { name: /สมชาย/ })).toBeNull();
    expect(screen.getByText("สมชาย")).toBeInTheDocument();
  });

  it("refuses a too-wide range by naming the cap and the way out", () => {
    renderGrid({ from: "2020-01-01", to: "2026-08-05" });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/92 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/มุมมองรายการ/)).toBeInTheDocument();
  });

  it("scrolls sideways inside its own container, with the touch-action pair", () => {
    // A bare overflow-x-auto row bleeds a horizontal swipe into a vertical page
    // jump; the repo's ui-class-contracts guard enforces the pair.
    const { container } = renderGrid();
    const scroller = container.querySelector(".overflow-x-auto");
    expect(scroller?.className).toContain("[touch-action:pan-x_pinch-zoom]");
  });

  it("says the range is empty rather than rendering a headless table", () => {
    renderGrid({ rows: [] });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/ไม่มีบันทึกการเช็คชื่อในช่วงนี้/)).toBeInTheDocument();
  });
});
