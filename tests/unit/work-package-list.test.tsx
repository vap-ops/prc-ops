// Spec 154: WorkPackageList threads `canOpen` (default true) through to every
// WorklistRow. With canOpen={false} no WP row is a link (the read-only coordinator
// view); omitted/default keeps the links. Rendered with site_admin (the action
// lens is its default), and one in_progress WP lands in the visible ต้องทำ band.

import { render, screen } from "@testing-library/react";
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
  },
];

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
