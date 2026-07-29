// Spec 374 U1 — WorkerAttendanceCalendar: the per-worker month calendar
// procurement reads check-in/out history from. Pure presentational (server-
// renderable): header card (rate + info), month summary (scanned/OT/estimate/
// paid variance + the cost-unconfirmed explainer), and the muster day cells.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkerAttendanceCalendar } from "@/components/features/labor/worker-attendance-calendar";
import { buildAttendanceMonth } from "@/lib/attendance/attendance-month";
import { baht } from "@/lib/format";

const month = buildAttendanceMonth({
  monthAnchor: "2026-07-01",
  musterRows: [
    {
      work_date: "2026-07-15",
      in_at: "2026-07-15T00:30:00Z", // 07:30 Bangkok
      out_at: "2026-07-15T10:00:00Z", // 17:00 Bangkok
      in_method: "qr",
      out_method: "manual",
      out_auto: false,
      ot_hours: 0,
      project_name: "P05 โพธิ์ทอง",
    },
    {
      work_date: "2026-07-16",
      in_at: "2026-07-16T00:35:00Z",
      out_at: "2026-07-16T10:00:00Z",
      in_method: "manual",
      out_method: "manual",
      out_auto: true,
      ot_hours: 0,
      project_name: "P05 โพธิ์ทอง",
    },
    {
      work_date: "2026-07-16",
      in_at: "2026-07-16T11:00:00Z",
      out_at: "2026-07-16T14:00:00Z",
      in_method: "qr",
      out_method: "qr",
      out_auto: false,
      ot_hours: 3,
      project_name: "P05 โพธิ์ทอง",
    },
  ],
  paidRows: [{ work_date: "2026-07-15", day_fraction: 1 }],
  dayRate: 450,
});

const worker = {
  id: "w1",
  name: "สมชาย ใจดี",
  levelLabel: null,
  dayRate: 450,
  phone: "0812345678",
  payTypeLabel: "รายวัน",
  active: true,
  costConfirmedAt: null,
  projectLabel: "P05 โพธิ์ทอง",
};

function renderCal(over: Partial<Parameters<typeof WorkerAttendanceCalendar>[0]> = {}) {
  return render(
    <WorkerAttendanceCalendar
      month={month}
      worker={worker}
      stdRate={null}
      prevHref="/workers/w1/attendance?m=2026-06"
      nextHref="/workers/w1/attendance?m=2026-08"
      {...over}
    />,
  );
}

describe("WorkerAttendanceCalendar", () => {
  it("header carries name, rate, pay type, phone, project", () => {
    renderCal();
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(baht(450)))).toBeInTheDocument();
    expect(screen.getByText(/รายวัน/)).toBeInTheDocument();
    expect(screen.getByText(/0812345678/)).toBeInTheDocument();
    expect(screen.getByText(/P05 โพธิ์ทอง/)).toBeInTheDocument();
  });

  it("month label is Buddhist-era Thai and steppers link prev/next", () => {
    renderCal();
    expect(screen.getByText("ก.ค. 2569")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เดือนก่อนหน้า" })).toHaveAttribute(
      "href",
      "/workers/w1/attendance?m=2026-06",
    );
    expect(screen.getByRole("link", { name: "เดือนถัดไป" })).toHaveAttribute(
      "href",
      "/workers/w1/attendance?m=2026-08",
    );
  });

  it("day cells show in–out and the OT chip", () => {
    renderCal();
    expect(screen.getByText(/07:30/)).toBeInTheDocument();
    expect(screen.getByText(/\+3 ชม\./)).toBeInTheDocument();
    // 07-16's latest out (21:00) came from the OT session; the auto flag
    // belongs to whichever row supplied the rendered out time.
    expect(screen.getByText(/21:00/)).toBeInTheDocument();
  });

  it("marks an auto check-out with the drill's (อัตโนมัติ) form", () => {
    const auto = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-20",
          in_at: "2026-07-20T00:30:00Z",
          out_at: "2026-07-20T10:00:00Z",
          in_method: "qr",
          out_method: "manual",
          out_auto: true,
          ot_hours: 0,
          project_name: "P05 โพธิ์ทอง",
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: auto });
    expect(screen.getByText(/\(อัตโนมัติ\)/)).toBeInTheDocument();
  });

  it("marks a next-day out with (+1 วัน)", () => {
    const overnight = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-21",
          in_at: "2026-07-21T15:00:00Z",
          out_at: "2026-07-21T18:30:00Z", // 01:30 Bangkok on the 22nd
          in_method: "qr",
          out_method: "qr",
          out_auto: false,
          ot_hours: 3,
          project_name: "P05 โพธิ์ทอง",
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: overnight });
    expect(screen.getByText(/\(\+1 วัน\)/)).toBeInTheDocument();
  });

  it("marks manually-recorded days with the drill's บันทึกมือ term", () => {
    renderCal();
    // 07-15 (manual OUT) and 07-16 (manual IN) both carry the marker.
    expect(screen.getAllByText("บันทึกมือ")).toHaveLength(2);
  });

  it("shows the project code on a cell only when it differs from the home project", () => {
    const away = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [
        {
          work_date: "2026-07-22",
          in_at: "2026-07-22T00:30:00Z",
          out_at: "2026-07-22T10:00:00Z",
          in_method: "qr",
          out_method: "qr",
          out_auto: false,
          ot_hours: 0,
          project_name: "P99 อื่น",
        },
      ],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: away });
    expect(screen.getByText("P99")).toBeInTheDocument();
    // Home-project cells (the shared fixture) never show a code.
    renderCal();
    expect(screen.queryByText("P05")).not.toBeInTheDocument();
  });

  it("summary: scanned days, OT total, labeled estimate, paid days, variance", () => {
    renderCal();
    expect(screen.getByText(/มาทำงาน 2 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/OT รวม 3 ชม\./)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`ประมาณการค่าแรง ฿${baht(900)}`))).toBeInTheDocument();
    expect(screen.getByText(/บันทึกค่าแรงแล้ว 1 วัน/)).toBeInTheDocument();
    expect(screen.getByText(/ต่างกัน 1 วัน/)).toBeInTheDocument();
  });

  it("explains WHY paid lags when the worker's cost is unconfirmed", () => {
    renderCal();
    expect(screen.getByText(/ยังไม่ยืนยันค่าแรง/)).toBeInTheDocument();
  });

  it("hides the unconfirmed explainer once cost is confirmed", () => {
    renderCal({ worker: { ...worker, costConfirmedAt: "2026-07-01T00:00:00Z" } });
    expect(screen.queryByText(/ยังไม่ยืนยันค่าแรง/)).not.toBeInTheDocument();
  });

  it("shows the standard level rate beside the worker rate when provided and different", () => {
    renderCal({ stdRate: 500, worker: { ...worker, levelLabel: "ช่างฝีมือ" } });
    expect(screen.getByText(new RegExp(`มาตรฐานระดับ ฿${baht(500)}`))).toBeInTheDocument();
  });

  it("omits the standard-rate compare when absent (non-money audience or unset)", () => {
    renderCal();
    expect(screen.queryByText(/มาตรฐานระดับ/)).not.toBeInTheDocument();
  });

  it("estimate renders — (not ฿0) when the worker has no rate", () => {
    const noRate = buildAttendanceMonth({
      monthAnchor: "2026-07-01",
      musterRows: [],
      paidRows: [],
      dayRate: null,
    });
    renderCal({ month: noRate, worker: { ...worker, dayRate: null } });
    expect(screen.getByText(/ประมาณการค่าแรง —/)).toBeInTheDocument();
  });
});
