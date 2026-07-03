// Spec 92 Unit D — schedule Gantt render smoke test. jsdom can't measure layout
// (bar x/width are visual — the operator verifies those on a phone), but this
// pins that the component renders without crashing, shows the period switch +
// grouped WP, the urgent chip, and the empty state.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScheduleGantt, type GanttWp } from "@/components/features/work-packages/schedule-gantt";

const SCHEDULED: GanttWp = {
  id: "w1",
  code: "WP-1",
  name: "งานเสาเข็ม",
  status: "in_progress",
  deliverableId: "d1",
  plannedStart: "2026-07-01",
  plannedEnd: "2026-07-10",
  priority: "urgent",
  isCritical: true,
  activityStart: null,
  activityEnd: null,
};

describe("ScheduleGantt", () => {
  it("renders the period switch, the งวดงาน group, the WP, and the ด่วน chip", () => {
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[SCHEDULED]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    expect(screen.getByText("วัน")).toBeInTheDocument();
    expect(screen.getByText("สัปดาห์")).toBeInTheDocument();
    expect(screen.getByText("เดือน")).toBeInTheDocument();
    expect(screen.getByText("งวดที่ 1")).toBeInTheDocument();
    expect(screen.getAllByText("งานเสาเข็ม").length).toBeGreaterThan(0);
    // ด่วน appears on the bar chip and in the legend.
    expect(screen.getAllByText("ด่วน").length).toBeGreaterThan(0);
  });

  it("tapping a bar reveals the open-detail action linking to the WP", () => {
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[SCHEDULED]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    // no selection yet → no open-detail action
    expect(screen.queryByText("เปิดรายละเอียด")).not.toBeInTheDocument();
    // tap the bar (its accessible label is "code name")
    fireEvent.click(screen.getByRole("button", { name: "WP-1 งานเสาเข็ม" }));
    const open = screen.getByRole("link", { name: /เปิดรายละเอียด/ });
    // Records the schedule as the referrer so the WP detail back chip returns to
    // the schedule, not the project page (sitemap review 2026-06-26).
    expect(open).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/w1?from=%2Fprojects%2Fp1%2Fschedule",
    );
  });

  it("always shows completed WPs (muted, never hidden)", () => {
    const done: GanttWp = {
      ...SCHEDULED,
      id: "w2",
      code: "WP-2",
      name: "งานเทพื้น",
      status: "complete",
      priority: "normal",
      isCritical: false,
    };
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[SCHEDULED, done]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    // completed WP is shown (no scope toggle anymore)
    expect(screen.getAllByText("งานเทพื้น").length).toBeGreaterThan(0);
    expect(screen.queryByRole("radio", { name: "ทั้งหมด" })).not.toBeInTheDocument();
  });

  it("shows the empty state only when no WP has planned dates OR activity (spec 255)", () => {
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[{ ...SCHEDULED, plannedStart: null, plannedEnd: null }]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    // new copy explains photos populate the calendar automatically
    expect(screen.getByText(/ถ่ายรูป/)).toBeInTheDocument();
  });

  // ---- Spec 255 U3 ----

  it("an activity-only WP renders a strip, not the empty state", () => {
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[
          {
            ...SCHEDULED,
            plannedStart: null,
            plannedEnd: null,
            activityStart: "2026-07-02",
            activityEnd: "2026-07-04",
          },
        ]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    expect(screen.queryByText(/ถ่ายรูป/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("ช่วงงานจริง WP-1")).toBeInTheDocument();
  });

  it("a planned WP with activity renders both the bar and the strip", () => {
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[{ ...SCHEDULED, activityStart: "2026-07-02", activityEnd: "2026-07-04" }]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "WP-1 งานเสาเข็ม" })).toBeInTheDocument();
    expect(screen.getByLabelText("ช่วงงานจริง WP-1")).toBeInTheDocument();
  });

  it("collapses no-data rows behind a count toggle", () => {
    const noData: GanttWp = {
      ...SCHEDULED,
      id: "w3",
      code: "WP-3",
      name: "งานทาสี",
      plannedStart: null,
      plannedEnd: null,
      priority: "normal",
      isCritical: false,
    };
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[SCHEDULED, noData]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    // hidden by default
    expect(screen.queryByText("งานทาสี")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /แสดงงานที่ยังไม่มีข้อมูล \(1\)/ });
    fireEvent.click(toggle);
    expect(screen.getAllByText("งานทาสี").length).toBeGreaterThan(0);
  });

  it("shows summary chips and hides zero-count chips", () => {
    // behind: planned_end 2026-07-01 < today 2026-07-05, in_progress
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[{ ...SCHEDULED, plannedEnd: "2026-07-01" }]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    expect(screen.getByText(/ช้ากว่าแผน 1/)).toBeInTheDocument();
    expect(screen.queryByText(/ครบกำหนดใน 7 วัน/)).not.toBeInTheDocument();
    expect(screen.queryByText(/มีงานจริง 7 วันล่าสุด/)).not.toBeInTheDocument();
  });

  it("legend explains the activity strip", () => {
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[{ ...SCHEDULED, activityStart: "2026-07-02", activityEnd: "2026-07-04" }]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    expect(screen.getByText("ช่วงที่มีงานจริง (จากรูปถ่าย)")).toBeInTheDocument();
  });

  it("auto-scrolls the timeline to today", () => {
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[SCHEDULED]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    // week view (default) dayWidth=16, domain starts 2026-07-01 → todayX = 4*16.
    // jsdom clientWidth is 0, so the ⅓-viewport offset is 0.
    const scroller = screen.getByTestId("gantt-scroll");
    expect(scroller.scrollLeft).toBe(64);
  });
});
