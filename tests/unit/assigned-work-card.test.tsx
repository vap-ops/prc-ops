import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssignedWorkCard } from "@/components/features/technician/assigned-work-card";
import type { AssignedWorkView } from "@/lib/technician/assigned-work-view";

// Spec 350 U2 — render pin for the /technician assigned-work card. No real muster
// team has WPs set yet, so the populated path never appears in a browser probe;
// this pins the empty state AND both populated shapes deterministically.

describe("AssignedWorkCard", () => {
  it("renders the empty state when there are no rows", () => {
    render(<AssignedWorkCard view={{ workDate: null, rows: [] }} />);
    expect(screen.getByText("ยังไม่มีงานที่ได้รับมอบหมาย")).toBeInTheDocument();
  });

  it("renders a งาน (group) row with its % and complete/total count", () => {
    const view: AssignedWorkView = {
      workDate: "2026-07-20",
      rows: [
        {
          wpId: "g1",
          code: "S-G1",
          name: "งานหนึ่ง",
          status: "in_progress",
          groupProgress: { percent: 67, completeCount: 2, totalCount: 3 },
          parentName: null,
        },
      ],
    };
    render(<AssignedWorkCard view={view} />);
    expect(screen.getByText("S-G1")).toBeInTheDocument();
    expect(screen.getByText("งานหนึ่ง")).toBeInTheDocument();
    expect(screen.getByText("67% (2/3 งานย่อย เสร็จ)")).toBeInTheDocument();
  });

  it("renders a งานย่อย (leaf) row with its parent name and the parent's %", () => {
    const view: AssignedWorkView = {
      workDate: "2026-07-20",
      rows: [
        {
          wpId: "l1",
          code: "S-L1",
          name: "ย่อย",
          status: "not_started",
          groupProgress: { percent: 50, completeCount: 1, totalCount: 2 },
          parentName: "งานปูกระเบื้อง",
        },
      ],
    };
    render(<AssignedWorkCard view={view} />);
    expect(screen.getByText("อยู่ในงาน งานปูกระเบื้อง · 50%")).toBeInTheDocument();
  });
});
