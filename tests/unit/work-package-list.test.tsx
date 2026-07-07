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
