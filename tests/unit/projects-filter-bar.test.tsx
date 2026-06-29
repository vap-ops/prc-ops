// Writing failing test first.
//
// Feedback 7d9d2c2b — the hub filter bar gains a client facet and drops the sort
// control. Presentational (server-safe) component: it maps the descriptors from
// list-view.ts to deep-linkable <Link> chips. The chip logic is unit-tested in
// projects-list-view.test.ts; this pins the render contract.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectsFilterBar } from "@/components/features/projects/projects-filter-bar";
import type { ProjectStatusChip, ProjectClientChip } from "@/lib/projects/list-view";

const statusChips: ProjectStatusChip[] = [
  { key: "all", label: "ทั้งหมด", count: 3, href: "/projects", active: true },
  { key: "active", label: "กำลังทำ", count: 1, href: "/projects?status=active", active: false },
];
const clientChips: ProjectClientChip[] = [
  { key: "all", label: "ทั้งหมด", count: 3, href: "/projects", active: true },
  { key: "cli-a", label: "Alpha", count: 1, href: "/projects?client=cli-a", active: false },
  { key: "none", label: "ไม่ระบุลูกค้า", count: 1, href: "/projects?client=none", active: false },
];

describe("ProjectsFilterBar (feedback 7d9d2c2b)", () => {
  it("renders a status filter group and a client filter group", () => {
    render(<ProjectsFilterBar statusChips={statusChips} clientChips={clientChips} />);
    expect(screen.getByRole("group", { name: "กรองตามสถานะ" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "กรองตามลูกค้า" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute(
      "href",
      "/projects?client=cli-a",
    );
    expect(screen.getByText("ไม่ระบุลูกค้า")).toBeInTheDocument();
  });

  it("no longer renders a sort control", () => {
    render(<ProjectsFilterBar statusChips={statusChips} clientChips={clientChips} />);
    expect(screen.queryByRole("group", { name: "เรียงลำดับ" })).toBeNull();
    expect(screen.queryByText("เรียง")).toBeNull();
  });
});
