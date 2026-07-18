// Writing failing test first.
//
// Spec 327 U4 — the timeline renderer's contract assertions: the scroll
// container carries overflow-x-auto + [touch-action:manipulation] (the
// tall-2-axis-surface form of the ui-class-contracts pact), the zoom pills are
// SCHEDULE_PERIODS verbatim, and both shelves render as labeled buckets.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProcurementTimeline } from "@/components/features/purchasing/procurement-timeline";
import { NO_ETA_LABEL, UNDATED_WP_LABEL } from "@/lib/i18n/labels";
import type { TimePrRow } from "@/lib/purchasing/time-view";

const WPS = [
  {
    id: "wp1",
    code: "WP-01",
    name: "งานเสาเข็ม",
    plannedStart: "2026-07-10",
    plannedEnd: "2026-07-20",
    isGroup: false,
  },
  {
    id: "wp2",
    code: "WP-02",
    name: "งานลอย",
    plannedStart: null,
    plannedEnd: null,
    isGroup: false,
  },
];

const PRS: TimePrRow[] = [
  {
    id: "pr-1",
    prNumber: 1,
    itemDescription: "ปูน",
    status: "on_route",
    eta: "2026-07-18",
    workPackageId: "wp1",
    requestedFromWorkPackageId: null,
  },
  {
    id: "pr-2",
    prNumber: 2,
    itemDescription: "เหล็ก",
    status: "approved",
    eta: null,
    workPackageId: "wp1",
    requestedFromWorkPackageId: null,
  },
];

describe("ProcurementTimeline", () => {
  it("scroll container carries overflow-x-auto AND touch-action:manipulation", () => {
    render(<ProcurementTimeline wps={WPS} prRows={PRS} todayIso="2026-07-16" />);
    const el = screen.getByTestId("procurement-timeline-scroll");
    expect(el.className).toContain("overflow-x-auto");
    expect(el.className).toContain("[touch-action:manipulation]");
  });

  it("renders the SCHEDULE_PERIODS zoom pills with one pressed", () => {
    render(<ProcurementTimeline wps={WPS} prRows={PRS} todayIso="2026-07-16" />);
    for (const label of ["ใกล้", "กลาง", "ไกล"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { pressed: true }).map((b) => b.textContent)).toEqual([
      "กลาง",
    ]);
  });

  it("renders both shelves as labeled buckets (§0.1)", () => {
    render(<ProcurementTimeline wps={WPS} prRows={PRS} todayIso="2026-07-16" />);
    expect(screen.getByText(new RegExp(UNDATED_WP_LABEL))).toBeInTheDocument();
    expect(screen.getByText(/งานลอย/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(NO_ETA_LABEL))).toBeInTheDocument();
    expect(screen.getByText(/เหล็ก/)).toBeInTheDocument();
  });
});
