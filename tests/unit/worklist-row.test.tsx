// Spec 154: WorklistRow gains an optional `canOpen` (default true). A read-only
// viewer (project_coordinator — in PROJECT_VIEW_ROLES, not SITE_STAFF_ROLES)
// can't reach the SITE_STAFF WP detail, so the row must render its content
// WITHOUT a link/tap affordance. Existing call sites omit the prop and keep the
// link.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorklistRow, type WorklistRowItem } from "@/components/features/chrome/worklist-row";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";

const PROJECT_ID = "proj-1";
const WP: WorklistRowItem = {
  id: "wp-1",
  code: "WP-001",
  name: "งานเทคอนกรีต",
  status: "in_progress",
  hasContractor: true,
  priority: "normal",
  isCritical: false,
  deliverableLabel: null,
};
const HREF = "/projects/proj-1/work-packages/wp-1";

describe("WorklistRow canOpen", () => {
  it("renders one link to the WP detail when the prop is omitted (default true)", () => {
    render(<WorklistRow projectId={PROJECT_ID} wp={WP} spine="bg-attn" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", HREF);
  });

  it("renders one link to the WP detail when canOpen is true", () => {
    render(<WorklistRow projectId={PROJECT_ID} wp={WP} spine="bg-attn" canOpen />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", HREF);
  });

  it("renders no link when canOpen is false, but keeps name + status", () => {
    render(<WorklistRow projectId={PROJECT_ID} wp={WP} spine="bg-attn" canOpen={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(WP.name)).toBeInTheDocument();
    expect(screen.getByText(WORK_PACKAGE_STATUS_LABEL[WP.status])).toBeInTheDocument();
  });
});
