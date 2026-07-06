// Writing failing test first.
//
// Spec 271 U2a — the roster ตามงาน lens grows a variance pill per งาน section
// header: worst class + count, coverage-aware (grey "หลักฐาน N%" instead of a
// red verdict when evidence is too thin). Display truth for every roster
// viewer; no role gate.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import {
  WorkPackageList,
  type WorkPackageListItem,
} from "@/app/projects/[projectId]/work-package-list";
import type { GroupVariancePill } from "@/lib/work-packages/variance";

const wp = (over: Partial<WorkPackageListItem>): WorkPackageListItem => ({
  id: "leaf-1",
  code: "WP-01-01",
  name: "งานย่อยหนึ่ง",
  status: "in_progress",
  deliverableId: null,
  hasContractor: false,
  priority: "normal",
  priorityRank: 0,
  isCritical: false,
  isGroup: false,
  parentId: "g1",
  ...over,
});

const GROUP = wp({ id: "g1", code: "WP-01", name: "งานปูน", isGroup: true, parentId: null });

function renderList(pill: GroupVariancePill | undefined) {
  render(
    <WorkPackageList
      projectId="p1"
      role="project_manager"
      workPackages={[GROUP, wp({})]}
      deliverables={[]}
      {...(pill ? { variancePillByGroup: { g1: pill } } : {})}
    />,
  );
}

describe("งาน section variance pill (spec 271 U2a)", () => {
  it("shows the worst class label + count on the section header", () => {
    renderList({
      worst: "late",
      counts: { late: 3, on_track: 5 },
      coveragePct: 80,
      lowCoverage: false,
    });
    expect(screen.getByText(/ช้ากว่าแผน 3/)).toBeInTheDocument();
  });

  it("suppresses the verdict below the coverage floor — grey evidence caption instead", () => {
    renderList({
      worst: "never_started_past_end",
      counts: { never_started_past_end: 4 },
      coveragePct: 10,
      lowCoverage: true,
    });
    expect(screen.getByText(/หลักฐาน 10%/)).toBeInTheDocument();
    expect(screen.queryByText(/ไม่ได้เริ่ม เลยกำหนดจบ/)).not.toBeInTheDocument();
  });

  it("renders no pill when the prop is absent (legacy callers unchanged)", () => {
    renderList(undefined);
    expect(screen.queryByText(/หลักฐาน|ช้ากว่าแผน|ตามแผน/)).not.toBeInTheDocument();
  });

  it("singular worst count omits the number (clean pill)", () => {
    renderList({ worst: "at_risk", counts: { at_risk: 1 }, coveragePct: 100, lowCoverage: false });
    expect(screen.getByText("ใกล้ครบกำหนด")).toBeInTheDocument();
  });
});
