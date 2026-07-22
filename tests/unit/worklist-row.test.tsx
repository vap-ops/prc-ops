// Spec 154: WorklistRow gains an optional `canOpen` (default true). A read-only
// viewer (project_coordinator — in PROJECT_VIEW_ROLES, not SITE_STAFF_ROLES)
// can't reach the SITE_STAFF WP detail, so the row must render its content
// WITHOUT a link/tap affordance. Existing call sites omit the prop and keep the
// link.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorklistRow, type WorklistRowItem } from "@/components/features/chrome/worklist-row";
import { REPORT_DEFECT_LABEL, WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";

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

// Back-nav sweep 2026-07-11: an optional `backFrom` wraps the row link in
// withBackFrom so the WP detail's back chip returns to the arrival surface
// (the งาน group page passes its own path). Omitted → plain href, the
// project fallback stays correct on the project WP list.
describe("WorklistRow backFrom", () => {
  it("threads ?from into the WP link when backFrom is set", () => {
    const backFrom = "/projects/proj-1/work-packages/group-9";
    render(<WorklistRow projectId={PROJECT_ID} wp={WP} spine="bg-attn" backFrom={backFrom} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `${HREF}?from=${encodeURIComponent(backFrom)}`,
    );
  });

  it("keeps the plain href when backFrom is omitted", () => {
    render(<WorklistRow projectId={PROJECT_ID} wp={WP} spine="bg-attn" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", HREF);
  });
});

// Spec 277: the row shows the category identity — a colored icon + the category
// letter-code (WP-12 → E-12) — when the WP reconciles to a global work-category.
describe("WorklistRow category identity (spec 277)", () => {
  it("replaces the WP code with the category letter-code when categorised", () => {
    render(
      <WorklistRow
        projectId={PROJECT_ID}
        wp={{ ...WP, code: "WP-12", categoryCode: "W05" }}
        spine="bg-attn"
      />,
    );
    expect(screen.getByText("E-12")).toBeInTheDocument();
    expect(screen.queryByText("WP-12")).toBeNull();
  });

  it("keeps the raw code when the WP is uncategorised", () => {
    render(<WorklistRow projectId={PROJECT_ID} wp={{ ...WP, code: "WP-12" }} spine="bg-attn" />);
    expect(screen.getByText("WP-12")).toBeInTheDocument();
  });
});

// Spec 243: every WorklistRow carries content-visibility:auto + contain-intrinsic-size
// so off-screen rows skip style/layout/paint. A long worklist (a project with hundreds
// of ungrouped WPs) otherwise mounts every row at once — a >100 ms main-thread long task
// = the "tap freezes before the screen changes" report. The utility rides on BOTH roots
// (the Link and the read-only container) so it covers every list context.
describe("WorklistRow content-visibility (spec 243)", () => {
  it("the interactive (Link) root skips off-screen render work", () => {
    render(<WorklistRow projectId={PROJECT_ID} wp={WP} spine="bg-attn" />);
    const root = screen.getByRole("link");
    expect(root.className).toContain("[content-visibility:auto]");
    expect(root.className).toContain("[contain-intrinsic-size:auto_96px]");
  });

  it("the read-only (canOpen=false) root also skips off-screen render work", () => {
    const { container } = render(
      <WorklistRow projectId={PROJECT_ID} wp={WP} spine="bg-attn" canOpen={false} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("[content-visibility:auto]");
    expect(root.className).toContain("[contain-intrinsic-size:auto_96px]");
  });
});

// Spec 337 U5 — the defect door rides as a SIBLING of the row's single anchor.
// A surface that threads ?from must not lose the back trail on the door alone,
// so the door gets the same withBackFrom treatment as the row above it.
describe("WorklistRow defect door (spec 337 U5)", () => {
  const DONE: WorklistRowItem = { ...WP, status: "complete" };

  it("threads ?from into the door as well as the row", () => {
    const backFrom = "/projects/proj-1/work-packages/group-9";
    render(
      <WorklistRow
        projectId={PROJECT_ID}
        wp={DONE}
        spine="bg-done"
        showDefectDoor
        backFrom={backFrom}
      />,
    );
    const door = screen.getByRole("link", { name: new RegExp(REPORT_DEFECT_LABEL) });
    expect(door).toHaveAttribute("href", `${HREF}?defect=1&from=${encodeURIComponent(backFrom)}`);
  });

  it("keeps the bare deep link when no backFrom is threaded", () => {
    render(<WorklistRow projectId={PROJECT_ID} wp={DONE} spine="bg-done" showDefectDoor />);
    expect(screen.getByRole("link", { name: new RegExp(REPORT_DEFECT_LABEL) })).toHaveAttribute(
      "href",
      `${HREF}?defect=1`,
    );
  });

  it("renders no door without the opt-in, even on a เสร็จแล้ว row", () => {
    render(<WorklistRow projectId={PROJECT_ID} wp={DONE} spine="bg-done" />);
    expect(
      screen.queryByRole("link", { name: new RegExp(REPORT_DEFECT_LABEL) }),
    ).not.toBeInTheDocument();
  });
});
