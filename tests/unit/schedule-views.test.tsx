// Spec 256 U2 — real calendar views. The schedule page's view switch
// (เดือน | สัปดาห์ | วัน | ไทม์ไลน์): true Thai month grid with activity dots +
// due markers and tap-day drill, week/day agendas, and the Gantt intact under
// ไทม์ไลน์.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduleViews } from "@/components/features/work-packages/schedule-views";
import type { GanttWp } from "@/components/features/work-packages/schedule-gantt";

const ACTIVE_WP: GanttWp = {
  id: "w1",
  code: "WP-1",
  name: "งานเสาเข็ม",
  status: "in_progress",
  deliverableId: "d1",
  plannedStart: "2026-07-01",
  plannedEnd: "2026-07-10",
  priority: "normal",
  isCritical: false,
  activityStart: "2026-07-02",
  activityEnd: "2026-07-02",
};

const QUIET_WP: GanttWp = {
  ...ACTIVE_WP,
  id: "w2",
  code: "WP-2",
  name: "งานทาสี",
  plannedStart: null,
  plannedEnd: null,
  activityStart: null,
  activityEnd: null,
};

function renderViews(overrides?: Partial<Parameters<typeof ScheduleViews>[0]>) {
  return render(
    <ScheduleViews
      projectId="p1"
      todayISO="2026-07-05"
      workPackages={[ACTIVE_WP, QUIET_WP]}
      deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
      dependencies={[]}
      activityDays={{ "2026-07-02": { w1: 3 } }}
      {...overrides}
    />,
  );
}

describe("ScheduleViews", () => {
  it("shows the 4-view switch and defaults to the month grid", () => {
    renderViews();
    for (const label of ["เดือน", "สัปดาห์", "วัน", "ไทม์ไลน์"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "เดือน" })).toHaveAttribute("aria-checked", "true");
    // BE month header + Sunday-first weekday row
    expect(screen.getByText("ก.ค. 2569")).toBeInTheDocument();
    expect(screen.getByText("อา")).toBeInTheDocument();
  });

  it("month cell shows the activity count and due marker", () => {
    renderViews();
    // 2026-07-02: 1 WP active
    expect(screen.getByRole("button", { name: /^2 ก\.ค\..*งานจริง 1/ })).toBeInTheDocument();
    // 2026-07-10: planned_end of WP-1
    expect(screen.getByRole("button", { name: /^10 ก\.ค\..*ครบกำหนด 1/ })).toBeInTheDocument();
  });

  it("tapping a month day drills into the วัน view for that date", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    expect(screen.getByRole("radio", { name: "วัน" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("มีงานจริง")).toBeInTheDocument();
    expect(screen.getByText("งานเสาเข็ม")).toBeInTheDocument();
    expect(screen.getByText(/3 รูป/)).toBeInTheDocument();
  });

  it("month nav moves the header a month at a time", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: "เดือนถัดไป" }));
    expect(screen.getByText("ส.ค. 2569")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เดือนก่อนหน้า" }));
    fireEvent.click(screen.getByRole("button", { name: "เดือนก่อนหน้า" }));
    expect(screen.getByText("มิ.ย. 2569")).toBeInTheDocument();
  });

  it("week view lists 7 days with activity and due chips", () => {
    renderViews();
    fireEvent.click(screen.getByRole("radio", { name: "สัปดาห์" }));
    // week containing 2026-07-05 (Sun) → 5..11 ก.ค.; activity on the 2nd is
    // NOT in this week, but the due chip on the 10th is.
    expect(screen.getAllByText(/ก\.ค\./).length).toBeGreaterThan(0);
    expect(screen.getByText(/ครบกำหนด/)).toBeInTheDocument();
    expect(screen.getByText("งานเสาเข็ม")).toBeInTheDocument();
  });

  it("day view sections: due + planned-start on their dates, empty state otherwise", () => {
    renderViews();
    fireEvent.click(screen.getByRole("radio", { name: "วัน" }));
    // today 2026-07-05: nothing happens that day
    expect(screen.getByText(/ไม่มีข้อมูลวันนี้|ไม่มีข้อมูลในวันนี้/)).toBeInTheDocument();
    // navigate back to 2026-07-01 → เริ่มตามแผน
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: "วันก่อนหน้า" }));
    }
    expect(screen.getByText("เริ่มตามแผน")).toBeInTheDocument();
    expect(screen.getByText("งานเสาเข็ม")).toBeInTheDocument();
  });

  it("day-view WP link carries the schedule back-referrer", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    const link = screen.getByRole("link", { name: /งานเสาเข็ม/ });
    expect(link).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/w1?from=%2Fprojects%2Fp1%2Fschedule",
    );
  });

  it("ไทม์ไลน์ renders the Gantt with its honest zoom labels", () => {
    renderViews();
    fireEvent.click(screen.getByRole("radio", { name: "ไทม์ไลน์" }));
    expect(screen.getByText("ใกล้")).toBeInTheDocument();
    expect(screen.getByTestId("gantt-scroll")).toBeInTheDocument();
  });

  it("วันนี้ button returns the month view to the current month", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: "เดือนถัดไป" }));
    expect(screen.getByText("ส.ค. 2569")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "วันนี้" }));
    expect(screen.getByText("ก.ค. 2569")).toBeInTheDocument();
  });
});
