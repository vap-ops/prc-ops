// Writing failing test first.
//
// Feedback 7d9d2c2b — the hub filter bar gains a client facet and drops the sort
// control. A later ask adds a project name/code search (?q=) as a plain GET form.
// Presentational (server-safe) component: it maps the descriptors from
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

const base = {
  statusChips,
  clientChips,
  query: "",
  status: "all" as const,
  client: "all",
  searchClearHref: "/projects",
};

describe("ProjectsFilterBar (feedback 7d9d2c2b)", () => {
  it("renders a status filter group and a client filter group", () => {
    render(<ProjectsFilterBar {...base} />);
    expect(screen.getByRole("group", { name: "กรองตามสถานะ" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "กรองตามลูกค้า" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Alpha/ })).toHaveAttribute(
      "href",
      "/projects?client=cli-a",
    );
    expect(screen.getByText("ไม่ระบุลูกค้า")).toBeInTheDocument();
  });

  it("no longer renders a sort control", () => {
    render(<ProjectsFilterBar {...base} />);
    expect(screen.queryByRole("group", { name: "เรียงลำดับ" })).toBeNull();
    expect(screen.queryByText("เรียง")).toBeNull();
  });
});

describe("ProjectsFilterBar — project search", () => {
  it("renders a GET search form posting q to /projects, seeded with the current query", () => {
    render(<ProjectsFilterBar {...base} query="บ้าน" />);
    const box = screen.getByRole("searchbox", { name: "ค้นหาโครงการ" });
    expect(box).toHaveAttribute("name", "q");
    expect(box).toHaveValue("บ้าน");
    const form = box.closest("form")!;
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/projects");
  });

  it("preserves active facets as hidden inputs so a search keeps them", () => {
    const { container } = render(
      <ProjectsFilterBar {...base} status="active" client="cli-a" query="x" />,
    );
    expect(container.querySelector('input[type="hidden"][name="status"]')).toHaveValue("active");
    expect(container.querySelector('input[type="hidden"][name="client"]')).toHaveValue("cli-a");
  });

  it("omits hidden facet inputs when they are at their defaults (clean URL)", () => {
    const { container } = render(<ProjectsFilterBar {...base} />);
    expect(container.querySelector('input[type="hidden"][name="status"]')).toBeNull();
    expect(container.querySelector('input[type="hidden"][name="client"]')).toBeNull();
  });

  // Regression guard (feedback 703d7e91 "Elements misplaced": "the search button
  // is misplaced"). The ค้นหา submit button is absolutely positioned with
  // `top-1/2` inside the h-11 field but was missing `-translate-y-1/2`, so its
  // TOP sat on the field's midline and the h-8 button hung 10px below the field.
  // The sibling search icon and clear-× both carry the translate; this pins the
  // button to the same vertical-centering contract.
  it("vertically centers the submit button inside the search field (703d7e91)", () => {
    render(<ProjectsFilterBar {...base} />);
    const submit = screen.getByRole("button", { name: "ค้นหา" });
    expect(submit.className).toContain("top-1/2");
    expect(submit.className).toContain("-translate-y-1/2");
  });

  it("shows a clear control only when a query is active, linking to the facets-without-q href", () => {
    const { rerender } = render(<ProjectsFilterBar {...base} query="" />);
    expect(screen.queryByRole("link", { name: "ล้างการค้นหา" })).toBeNull();

    rerender(
      <ProjectsFilterBar
        {...base}
        status="active"
        query="บ้าน"
        searchClearHref="/projects?status=active"
      />,
    );
    expect(screen.getByRole("link", { name: "ล้างการค้นหา" })).toHaveAttribute(
      "href",
      "/projects?status=active",
    );
  });
});
