// Writing failing test first.
//
// Spec 323 U2 — the universal cross-project lens. Generalizes spec 311 U1's
// /requests site chip row (buildSiteProjectChips + SiteProjectChips) into a
// surface-agnostic primitive any procurement screen can mount:
//   - pure core in @/lib/nav/project-lens (buildProjectLensChips + projectLensHref)
//   - <ProjectLens> client component that self-derives the active project from the
//     URL and preserves every OTHER query param when switching projects.
// A cross-project FILTER (default ทุกโครงการ, narrow to one), NOT a global
// switcher — and it collapses to nothing in a single-project world (≤1 named
// project → no chips), so today's lean UI is unchanged.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { buildProjectLensChips, projectLensHref } from "@/lib/nav/project-lens";
import { ProjectLens } from "@/components/features/common/project-lens";
import { ALL_PROJECTS_OPTION_LABEL, PROJECT_FILTER_ARIA } from "@/lib/i18n/labels";

const { mockUsePathname, mockUseSearchParams } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
  mockUseSearchParams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
  useSearchParams: mockUseSearchParams,
}));

const PROJECTS = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
];

const hrefFor = (projectId: string | null) =>
  projectId ? `/reports?project=${projectId}` : "/reports";

describe("buildProjectLensChips", () => {
  it("returns no chips when the rows span one project or none (single-project world unchanged)", () => {
    expect(buildProjectLensChips({ projects: [], activeProjectId: null, hrefFor })).toEqual([]);
    expect(
      buildProjectLensChips({
        projects: [{ id: "p1", name: "Alpha" }],
        activeProjectId: null,
        hrefFor,
      }),
    ).toEqual([]);
  });

  it("builds ทุกโครงการ first, then one chip per project, hrefs from hrefFor", () => {
    const chips = buildProjectLensChips({ projects: PROJECTS, activeProjectId: null, hrefFor });
    expect(chips.map((c) => c.label)).toEqual([ALL_PROJECTS_OPTION_LABEL, "Alpha", "Beta"]);
    expect(chips.map((c) => c.href)).toEqual([
      "/reports",
      "/reports?project=p1",
      "/reports?project=p2",
    ]);
    expect(chips.map((c) => c.active)).toEqual([true, false, false]);
  });

  it("marks the filtered project active instead of ทุกโครงการ", () => {
    const chips = buildProjectLensChips({ projects: PROJECTS, activeProjectId: "p2", hrefFor });
    expect(chips.map((c) => c.active)).toEqual([false, false, true]);
  });

  it("drops unresolvable (empty-name) projects — no blank chip, no false >1 trip", () => {
    expect(
      buildProjectLensChips({
        projects: [
          { id: "p1", name: "Alpha" },
          { id: "p2", name: "" },
        ],
        activeProjectId: null,
        hrefFor,
      }),
    ).toEqual([]);
    const chips = buildProjectLensChips({
      projects: [...PROJECTS, { id: "p3", name: "" }],
      activeProjectId: null,
      hrefFor,
    });
    expect(chips.map((c) => c.label)).toEqual([ALL_PROJECTS_OPTION_LABEL, "Alpha", "Beta"]);
  });
});

describe("projectLensHref", () => {
  it("sets ?project= on the path, preserving every other query param", () => {
    expect(projectLensHref("/requests", "view=active&band=to_order", "p1")).toBe(
      "/requests?view=active&band=to_order&project=p1",
    );
  });

  it("clears the project axis (null) while keeping the other params", () => {
    expect(projectLensHref("/requests", "view=active&project=p1", null)).toBe(
      "/requests?view=active",
    );
  });

  it("replaces an existing project value rather than appending a second one", () => {
    expect(projectLensHref("/reports", "project=p1", "p2")).toBe("/reports?project=p2");
  });

  it("returns the bare path when clearing the only param", () => {
    expect(projectLensHref("/expenses", "project=p1", null)).toBe("/expenses");
  });
});

describe("<ProjectLens>", () => {
  function mountAt(pathname: string, search: string, projects = PROJECTS) {
    mockUsePathname.mockReturnValue(pathname);
    mockUseSearchParams.mockReturnValue(new URLSearchParams(search));
    return render(<ProjectLens projects={projects} />);
  }

  it("renders nothing in a single-project world (≤1 named project)", () => {
    const { container } = mountAt("/requests", "", [{ id: "p1", name: "Alpha" }]);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a labeled group of chip links, ทุกโครงการ first", () => {
    mountAt("/requests", "");
    const group = screen.getByRole("group", { name: PROJECT_FILTER_ARIA });
    expect(group).toBeInTheDocument();
    const links = screen.getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual([ALL_PROJECTS_OPTION_LABEL, "Alpha", "Beta"]);
  });

  it("reads the active project from the URL and marks its chip aria-current", () => {
    mountAt("/requests", "project=p2");
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: ALL_PROJECTS_OPTION_LABEL })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("preserves other params when switching project, and ทุกโครงการ clears it", () => {
    mountAt("/requests", "view=active&project=p1");
    // ทุกโครงการ drops ?project= but keeps ?view=
    expect(screen.getByRole("link", { name: ALL_PROJECTS_OPTION_LABEL })).toHaveAttribute(
      "href",
      "/requests?view=active",
    );
    // A project chip sets its id while preserving the view axis.
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute(
      "href",
      "/requests?view=active&project=p2",
    );
  });
});
