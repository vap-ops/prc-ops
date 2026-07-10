// Spec 270 U4 — the งาน (group WP) detail view: oversight only. Children list
// + the DB-derived rollup pill + n/m เสร็จ + (manager-only) read-only money
// aggregates. NO capture zone, NO manual status controls — a งาน is a grouping
// entity (operator directive 2026-07-06; DB guards enforce, this view simply
// never offers).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupDetailView } from "@/components/features/work-packages/group-detail-view";

const GROUP = { id: "g-1", code: "WP-05", name: "งานหลังคา", status: "in_progress" as const };
const CHILDREN = [
  {
    id: "c-1",
    code: "WP-05-01",
    name: "งานโครงหลังคา",
    status: "complete" as const,
    hasContractor: true,
    priority: "normal" as const,
    isCritical: false,
  },
  {
    id: "c-2",
    code: "WP-05-02",
    name: "งานมุงกระเบื้อง",
    status: "in_progress" as const,
    hasContractor: false,
    priority: "urgent" as const,
    isCritical: false,
  },
];
const MONEY = {
  materials: 1000,
  storeIssues: 300,
  storeReturns: 120,
  materialNet: 1180,
  laborTotal: 900,
  total: 2080,
};

describe("GroupDetailView", () => {
  it("renders the งาน chip, rollup summary and child rows as WP links", () => {
    render(
      <GroupDetailView
        projectId="proj-1"
        group={GROUP}
        childItems={CHILDREN}
        money={null}
        canOpenChildren
      />,
    );
    expect(screen.getByText("งาน")).toBeInTheDocument(); // the group chip
    expect(screen.getByText("1/2 เสร็จ")).toBeInTheDocument();
    // Back-nav sweep 2026-07-11: child rows thread ?from=<this งาน page> so the
    // child WP's back chip returns HERE, not two levels up to the project.
    const from = encodeURIComponent("/projects/proj-1/work-packages/g-1");
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain(`/projects/proj-1/work-packages/c-1?from=${from}`);
    expect(links).toContain(`/projects/proj-1/work-packages/c-2?from=${from}`);
    // oversight only — no capture affordance ever renders here
    expect(screen.queryByText(/ถ่ายรูป/)).not.toBeInTheDocument();
  });

  it("shows the money card only when aggregates are supplied (manager gate upstream)", () => {
    const { rerender } = render(
      <GroupDetailView
        projectId="proj-1"
        group={GROUP}
        childItems={CHILDREN}
        money={null}
        canOpenChildren
      />,
    );
    expect(screen.queryByText("ค่าแรงรวม")).not.toBeInTheDocument();
    rerender(
      <GroupDetailView
        projectId="proj-1"
        group={GROUP}
        childItems={CHILDREN}
        money={MONEY}
        canOpenChildren
      />,
    );
    expect(screen.getByText("ค่าแรงรวม")).toBeInTheDocument();
    expect(screen.getByText("2,080.00")).toBeInTheDocument(); // total, baht()
    expect(screen.getByText(/หักคืนเข้าคลัง/)).toBeInTheDocument(); // returns netting disclosed
  });

  it("renders an empty-children notice instead of rows", () => {
    render(
      <GroupDetailView
        projectId="proj-1"
        group={GROUP}
        childItems={[]}
        money={null}
        canOpenChildren
      />,
    );
    expect(screen.getByText(/ยังไม่มีงานย่อย/)).toBeInTheDocument();
  });
});
