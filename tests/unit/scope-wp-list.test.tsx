// Writing failing test first.
//
// Spec 327 U2 — the ขอบเขต WP list (procurement variant — deliberately NOT the
// SA/PM work-package-list, which is a 3-lens shared component). Grouped roster
// (spec 270 idiom) + per-WP supply chips from the overlay; late-risk rows state
// the conflict (ของถึง X — งานเริ่ม Y, §0.2); no-plan rows carry the
// create-plan door (§0.3); anchorless PRs render as the คลัง project bucket
// above the list (§0.1). Rows link the WP detail with ?from back-threading
// (nav-coherence Decision 1 — WP detail is a multi-parent page).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScopeWpList } from "@/components/features/purchasing/scope-wp-list";
import type { WpSupplyOverlay, ProjectBucket } from "@/lib/purchasing/wp-supply-overlay";
import { formatThaiDate } from "@/lib/i18n/labels";

const PROJECT = "11111111-1111-4111-8111-111111111111";

const ZERO: WpSupplyOverlay = {
  openCount: 0,
  incomingCount: 0,
  nextArrival: null,
  lateEta: null,
  hasPlan: true,
};
const EMPTY_BUCKET: ProjectBucket = { openCount: 0, incomingCount: 0, nextArrival: null };

function wp(overrides: Record<string, unknown>) {
  return {
    id: "wp1",
    code: "WP-01",
    name: "งานเสาเข็ม",
    status: "in_progress" as const,
    isGroup: false,
    parentId: null,
    plannedStart: "2026-07-10",
    categoryCode: null,
    ...overrides,
  };
}

describe("ScopeWpList", () => {
  it("renders a leaf row linking the WP detail with ?from back to the scope view", () => {
    render(
      <ScopeWpList
        projectId={PROJECT}
        wps={[wp({})]}
        overlay={new Map([["wp1", ZERO]])}
        projectBucket={EMPTY_BUCKET}
      />,
    );
    const link = screen.getByRole("link", { name: /งานเสาเข็ม/ });
    expect(link.getAttribute("href")).toContain(`/projects/${PROJECT}/work-packages/wp1`);
    expect(link.getAttribute("href")).toContain("from=");
  });

  it("shows the supply chips — ขอซื้อ, กำลังมา, and the next-arrival date", () => {
    render(
      <ScopeWpList
        projectId={PROJECT}
        wps={[wp({})]}
        overlay={
          new Map([["wp1", { ...ZERO, openCount: 2, incomingCount: 1, nextArrival: "2026-07-21" }]])
        }
        projectBucket={EMPTY_BUCKET}
      />,
    );
    expect(screen.getByText(/ขอซื้อ 2/)).toBeInTheDocument();
    expect(screen.getByText(/กำลังมา 1/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(formatThaiDate("2026-07-21")))).toBeInTheDocument();
  });

  it("states the late-risk conflict on a flagged row (§0.2)", () => {
    render(
      <ScopeWpList
        projectId={PROJECT}
        wps={[wp({})]}
        overlay={new Map([["wp1", { ...ZERO, openCount: 1, lateEta: "2026-08-01" }]])}
        projectBucket={EMPTY_BUCKET}
      />,
    );
    const conflict = screen.getByText(
      new RegExp(
        `ของถึง ${formatThaiDate("2026-08-01")}.*งานเริ่ม ${formatThaiDate("2026-07-10")}`,
      ),
    );
    expect(conflict).toBeInTheDocument();
  });

  it("gives a no-plan leaf the create-plan door (§0.3)", () => {
    render(
      <ScopeWpList
        projectId={PROJECT}
        wps={[wp({})]}
        overlay={new Map([["wp1", { ...ZERO, hasPlan: false }]])}
        projectBucket={EMPTY_BUCKET}
      />,
    );
    const door = screen.getByRole("link", { name: /ยังไม่มีแผนจัดหา/ });
    expect(door.getAttribute("href")).toContain(`/projects/${PROJECT}/supply-plan`);
  });

  it("renders the คลัง project bucket above the list when anchorless PRs exist, hides it at zero (§0.1)", () => {
    const { rerender } = render(
      <ScopeWpList
        projectId={PROJECT}
        wps={[wp({})]}
        overlay={new Map([["wp1", ZERO]])}
        projectBucket={{ openCount: 3, incomingCount: 1, nextArrival: "2026-07-20" }}
      />,
    );
    expect(screen.getByText(/คลัง/)).toBeInTheDocument();
    expect(screen.getByText(/ขอซื้อ 3/)).toBeInTheDocument();
    rerender(
      <ScopeWpList
        projectId={PROJECT}
        wps={[wp({})]}
        overlay={new Map([["wp1", ZERO]])}
        projectBucket={EMPTY_BUCKET}
      />,
    );
    expect(screen.queryByText(/คลัง/)).not.toBeInTheDocument();
  });

  it("groups งาน sections with progress and nests children (spec 270 roster idiom)", () => {
    const group = wp({ id: "g1", code: "WP-10", name: "งานโครงสร้าง", isGroup: true });
    const child = wp({ id: "wp2", code: "WP-11", name: "งานเทพื้น", parentId: "g1" });
    render(
      <ScopeWpList
        projectId={PROJECT}
        wps={[group, child]}
        overlay={new Map([["wp2", ZERO]])}
        projectBucket={EMPTY_BUCKET}
      />,
    );
    expect(screen.getByText(/งานโครงสร้าง/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /งานเทพื้น/ })).toBeInTheDocument();
  });

  it("shows an empty-state door when the project has no WPs (§0.3)", () => {
    render(
      <ScopeWpList projectId={PROJECT} wps={[]} overlay={new Map()} projectBucket={EMPTY_BUCKET} />,
    );
    expect(screen.getByText(/ยังไม่มีงาน/)).toBeInTheDocument();
  });

  it("still renders the คลัง bucket on a WP-less project (§0.1 — fresh-eyes catch)", () => {
    render(
      <ScopeWpList
        projectId={PROJECT}
        wps={[]}
        overlay={new Map()}
        projectBucket={{ openCount: 2, incomingCount: 0, nextArrival: null }}
      />,
    );
    expect(screen.getByText(/คลัง/)).toBeInTheDocument();
    expect(screen.getByText(/ขอซื้อ 2/)).toBeInTheDocument();
  });

  it("wears group-anchored counts + conflict on the งาน header (§0.1 — fresh-eyes catch)", () => {
    const group = wp({
      id: "g1",
      code: "WP-10",
      name: "งานโครงสร้าง",
      isGroup: true,
      plannedStart: "2026-07-10",
    });
    const child = wp({ id: "wp2", code: "WP-11", name: "งานเทพื้น", parentId: "g1" });
    render(
      <ScopeWpList
        projectId={PROJECT}
        wps={[group, child]}
        overlay={
          new Map([
            ["g1", { ...ZERO, openCount: 5, lateEta: "2026-08-01" }],
            ["wp2", ZERO],
          ])
        }
        projectBucket={EMPTY_BUCKET}
      />,
    );
    expect(screen.getByText(/ขอซื้อ 5/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`ของถึง ${formatThaiDate("2026-08-01")}`)),
    ).toBeInTheDocument();
  });
});
