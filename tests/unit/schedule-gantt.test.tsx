// Spec 92 Unit D — schedule Gantt render smoke test. jsdom can't measure layout
// (bar x/width are visual — the operator verifies those on a phone), but this
// pins that the component renders without crashing, shows the period switch +
// grouped WP, the urgent chip, and the empty state.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScheduleGantt, type GanttWp } from "@/components/features/schedule-gantt";

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

  it("shows the empty state when no WP has planned dates", () => {
    render(
      <ScheduleGantt
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[{ ...SCHEDULED, plannedStart: null, plannedEnd: null }]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
      />,
    );
    expect(screen.getByText(/ยังไม่มีงานที่กำหนดวันที่/)).toBeInTheDocument();
  });
});
