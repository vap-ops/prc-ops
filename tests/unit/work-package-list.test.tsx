// Spec 154: WorkPackageList threads `canOpen` (default true) through to every
// WorklistRow. With canOpen={false} no WP row is a link (the read-only coordinator
// view); omitted/default keeps the links. Rendered with site_admin (the action
// lens is its default), and one in_progress WP lands in the visible ต้องทำ band.
//
// Spec 270 U3: a project that adopted the งาน/งานย่อย hierarchy gets a third
// "ตามงาน" lens (default for the manager tier) rendering collapsible งาน
// sections; groups never appear as actionable rows in the other lenses.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  WorkPackageList,
  type WorkPackageListItem,
} from "@/app/projects/[projectId]/work-package-list";
import { REPORT_DEFECT_LABEL } from "@/lib/i18n/labels";
import { defectHref } from "@/lib/work-packages/defect-deep-link";

const PROJECT_ID = "proj-1";
const HREF = "/projects/proj-1/work-packages/wp-1";
const WPS: WorkPackageListItem[] = [
  {
    id: "wp-1",
    code: "WP-001",
    name: "งานเทคอนกรีต",
    status: "in_progress",
    deliverableId: null,
    hasContractor: true,
    priority: "normal",
    priorityRank: 2,
    isCritical: false,
    isGroup: false,
    parentId: null,
    categoryCode: null,
  },
];

// An adopted-project roster: one งาน (derived in_progress) + two งานย่อย
// children (one complete, one in_progress) + nothing parentless.
function groupedFixture(): WorkPackageListItem[] {
  const base = {
    deliverableId: null,
    hasContractor: true,
    priority: "normal" as const,
    priorityRank: 2,
    isCritical: false,
    categoryCode: null,
  };
  return [
    {
      ...base,
      id: "g-1",
      code: "WP-05",
      name: "งานหลังคา",
      status: "in_progress",
      isGroup: true,
      parentId: null,
      hasContractor: false,
    },
    {
      ...base,
      id: "c-2",
      code: "WP-05-02",
      name: "งานมุงกระเบื้อง",
      status: "in_progress",
      isGroup: false,
      parentId: "g-1",
    },
    {
      ...base,
      id: "c-1",
      code: "WP-05-01",
      name: "งานโครงหลังคา",
      status: "complete",
      isGroup: false,
      parentId: "g-1",
    },
  ];
}

describe("WorkPackageList canOpen", () => {
  it("renders the WP row as a link when canOpen is omitted (default true)", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={WPS}
        deliverables={[]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.some((a) => a.getAttribute("href") === HREF)).toBe(true);
  });

  it("renders zero row links when canOpen is false, content still shows", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={WPS}
        deliverables={[]}
        canOpen={false}
      />,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText("งานเทคอนกรีต")).toBeInTheDocument();
  });
});

// Spec 337 U5 — the defect door. F6 of the WP-gates audit: reopen_work_package_for_defect
// has NEVER been used on prod, and the only entry point is buried on the finished WP's
// own detail page. The เสร็จแล้ว band is where someone looking at finished work already
// is, so the door goes there — as a SIBLING of the row, never nested inside it (the
// WorklistRow single-anchor invariant, spec 47).
const DEFECT_FIXTURE: WorkPackageListItem[] = [
  ...WPS,
  {
    id: "wp-done",
    code: "WP-002",
    name: "งานฉาบผนัง",
    status: "complete",
    deliverableId: null,
    hasContractor: true,
    priority: "normal",
    priorityRank: 2,
    isCritical: false,
    isGroup: false,
    parentId: null,
    categoryCode: null,
  },
];

// Only site_admin defaults to the action lens; every other role lands on
// deliverable/group, where the เสร็จแล้ว band does not exist. Select the lens
// explicitly so a role-gate assertion below is really about the ROLE GATE and
// not about which lens that role happens to open on (a mutation-check caught
// exactly that fake pass).
function openDoneBand() {
  fireEvent.click(screen.getByRole("radio", { name: "ตามสถานะ" }));
  fireEvent.click(screen.getByRole("button", { name: /เสร็จแล้ว 1 รายการ/ }));
}

describe("WorkPackageList defect door (spec 337 U5)", () => {
  it("offers the defect door on a เสร็จแล้ว row, deep-linking to the WP with ?defect=1", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={DEFECT_FIXTURE}
        deliverables={[]}
      />,
    );
    openDoneBand();
    const door = screen.getByRole("link", { name: `${REPORT_DEFECT_LABEL} WP-002 งานฉาบผนัง` });
    // Pinned as a LITERAL, not via defectHref() — asserting the producer against
    // itself would let the key change on both sides and stay green.
    expect(door).toHaveAttribute("href", "/projects/proj-1/work-packages/wp-done?defect=1");
    expect(door).toHaveAttribute("href", defectHref(PROJECT_ID, "wp-done"));
  });

  it("keeps the row itself a single anchor — the door is a sibling, not nested", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={DEFECT_FIXTURE}
        deliverables={[]}
      />,
    );
    openDoneBand();
    const door = screen.getByRole("link", { name: new RegExp(REPORT_DEFECT_LABEL) });
    // Spec 47: nesting an <a> inside the row's <a> is invalid HTML and breaks
    // the whole-row tap. The door must have NO anchor ancestor.
    expect(door.parentElement?.closest("a")).toBeNull();
  });

  it("offers no door on a row that is not เสร็จแล้ว", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={WPS}
        deliverables={[]}
      />,
    );
    // The ต้องทำ row is visible without any disclosure; no door anywhere.
    expect(screen.getByText("งานเทคอนกรีต")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: new RegExp(REPORT_DEFECT_LABEL) }),
    ).not.toBeInTheDocument();
  });

  it("hides the door from the read-only WP viewer (procurement)", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="procurement"
        workPackages={DEFECT_FIXTURE}
        deliverables={[]}
      />,
    );
    openDoneBand();
    // The row still opens (procurement reads the WP to raise a PR) — only the
    // defect door is suppressed, matching the detail page's readOnly branch.
    expect(screen.getByText("งานฉาบผนัง")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: new RegExp(REPORT_DEFECT_LABEL) }),
    ).not.toBeInTheDocument();
  });

  it("hides the door when rows are not openable at all (canOpen=false)", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="project_coordinator"
        workPackages={DEFECT_FIXTURE}
        deliverables={[]}
        canOpen={false}
      />,
    );
    openDoneBand();
    expect(screen.getByText("งานฉาบผนัง")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("WorkPackageList grouped roster (spec 270 U3)", () => {
  it("legacy flat project: no ตามงาน lens option, two lenses as today", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="project_manager"
        workPackages={WPS}
        deliverables={[]}
      />,
    );
    expect(screen.queryByRole("radio", { name: "ตามงาน" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("adopted project: ตามงาน lens exists and is the manager default", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="project_manager"
        workPackages={groupedFixture()}
        deliverables={[]}
      />,
    );
    expect(screen.getByRole("radio", { name: "ตามงาน" })).toHaveAttribute("aria-checked", "true");
  });

  it("งาน section header shows code, name, rollup pill and n/m เสร็จ; children open on tap sorted by code", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="project_manager"
        workPackages={groupedFixture()}
        deliverables={[]}
      />,
    );
    const header = screen.getByRole("button", { name: /งานหลังคา/ });
    expect(header).toHaveTextContent("WP-05");
    expect(header).toHaveTextContent("กำลังดำเนินการ"); // rollup pill = the group row's derived status
    expect(header).toHaveTextContent("1/2 เสร็จ");
    // collapsed: children hidden
    expect(screen.queryByText("งานโครงหลังคา")).not.toBeInTheDocument();
    fireEvent.click(header);
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    const posC1 = links.indexOf("/projects/proj-1/work-packages/c-1");
    const posC2 = links.indexOf("/projects/proj-1/work-packages/c-2");
    expect(posC1).toBeGreaterThanOrEqual(0);
    expect(posC2).toBeGreaterThan(posC1); // WP-05-01 before WP-05-02
  });

  it("the งาน lens offers a detail link per section, beside (not inside) the expand button", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="project_manager"
        workPackages={groupedFixture()}
        deliverables={[]}
      />,
    );
    const detailLink = screen.getByRole("link", { name: /รายละเอียดงาน WP-05/ });
    expect(detailLink).toHaveAttribute("href", "/projects/proj-1/work-packages/g-1");
    // a11y: the link must not be nested inside the expand button
    expect(detailLink.closest("button")).toBeNull();
  });

  it("the งาน header is not a WP-detail link and groups never appear in the status lens", () => {
    render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="site_admin"
        workPackages={groupedFixture()}
        deliverables={[]}
      />,
    );
    // SA default = ตามสถานะ (worklist doctrine): group row must not render as a row
    expect(screen.getByRole("radio", { name: "ตามสถานะ" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("งานหลังคา")).not.toBeInTheDocument();
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).not.toContain("/projects/proj-1/work-packages/g-1");
  });
});

describe("WorkPackageList search (spec 293)", () => {
  function renderGrouped() {
    return render(
      <WorkPackageList
        projectId={PROJECT_ID}
        role="project_manager"
        workPackages={groupedFixture()}
        deliverables={[]}
      />,
    );
  }
  const searchBox = () => screen.getByRole("textbox", { name: /ค้นหา/ });

  it("a non-empty query replaces the lens with a flat hit list (surfaces a collapsed leaf)", () => {
    renderGrouped();
    // Adopted default = ตามงาน, sections collapsed → the leaf is hidden.
    expect(screen.queryByText("งานโครงหลังคา")).not.toBeInTheDocument();
    fireEvent.change(searchBox(), { target: { value: "WP-05-01" } });
    // The leaf surfaces flat; the lens toggle is gone while searching.
    expect(screen.getByText("งานโครงหลังคา")).toBeInTheDocument();
    expect(screen.queryByText("งานมุงกระเบื้อง")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "มุมมองรายการงาน" })).not.toBeInTheDocument();
  });

  it("matches on name substring", () => {
    renderGrouped();
    fireEvent.change(searchBox(), { target: { value: "มุงกระเบื้อง" } });
    expect(screen.getByText("งานมุงกระเบื้อง")).toBeInTheDocument();
    expect(screen.queryByText("งานโครงหลังคา")).not.toBeInTheDocument();
  });

  it("never surfaces a งาน group even when its code matches", () => {
    renderGrouped();
    fireEvent.change(searchBox(), { target: { value: "WP-05" } });
    expect(screen.queryByText("งานหลังคา")).not.toBeInTheDocument(); // the group
    expect(screen.getByText("งานโครงหลังคา")).toBeInTheDocument();
    expect(screen.getByText("งานมุงกระเบื้อง")).toBeInTheDocument();
  });

  it("shows an empty notice when nothing matches, and clearing restores the lens", () => {
    renderGrouped();
    fireEvent.change(searchBox(), { target: { value: "zzzzz" } });
    expect(screen.getByText(/ไม่พบ/)).toBeInTheDocument();
    fireEvent.change(searchBox(), { target: { value: "" } });
    expect(screen.getByRole("radiogroup", { name: "มุมมองรายการงาน" })).toBeInTheDocument();
  });
});
