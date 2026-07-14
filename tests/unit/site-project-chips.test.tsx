// Writing failing test first.
//
// Spec 311 U1 — the SITE worklist project filter. At 2+ concurrent active
// projects the non-procurement /requests list merges every visible project's
// rows; this chip row (spec-137 chip idiom, like the view/mine chips) is the
// disambiguator. Pure builder (buildSiteProjectChips) + server-safe
// presentational row (SiteProjectChips), mirroring the spec-138 U3
// worklist-status-chips split. The row and the builder BOTH collapse in a
// single-project world (≤1 option → no chips) so today's UI is unchanged.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { buildSiteProjectChips } from "@/lib/purchasing/site-project-chips";
import { SiteProjectChips } from "@/components/features/purchasing/site-project-chips";
import { ALL_PROJECTS_OPTION_LABEL, PROJECT_FILTER_ARIA } from "@/lib/i18n/labels";

const PROJECTS = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
];

const hrefFor = (projectId: string | null) =>
  projectId ? `/requests?project=${projectId}` : "/requests";

describe("buildSiteProjectChips", () => {
  it("returns no chips when the rows span one project or none (single-project world unchanged)", () => {
    expect(buildSiteProjectChips({ projects: [], activeProjectId: null, hrefFor })).toEqual([]);
    expect(
      buildSiteProjectChips({
        projects: [{ id: "p1", name: "Alpha" }],
        activeProjectId: null,
        hrefFor,
      }),
    ).toEqual([]);
  });

  it("builds ทุกโครงการ first, then one chip per project, hrefs from hrefFor", () => {
    const chips = buildSiteProjectChips({ projects: PROJECTS, activeProjectId: null, hrefFor });
    expect(chips.map((c) => c.label)).toEqual([ALL_PROJECTS_OPTION_LABEL, "Alpha", "Beta"]);
    expect(chips.map((c) => c.href)).toEqual([
      "/requests",
      "/requests?project=p1",
      "/requests?project=p2",
    ]);
    expect(chips.map((c) => c.active)).toEqual([true, false, false]);
  });

  it("marks the filtered project active instead of ทุกโครงการ", () => {
    const chips = buildSiteProjectChips({ projects: PROJECTS, activeProjectId: "p2", hrefFor });
    expect(chips.map((c) => c.active)).toEqual([false, false, true]);
  });

  it("drops unresolvable (empty-name) projects — no blank chip, no false >1 trip", () => {
    // An own PR in a non-member project resolves no name (membership-scoped
    // projects read). Here p2 is unnamed → only 1 named project remains → no chips.
    expect(
      buildSiteProjectChips({
        projects: [
          { id: "p1", name: "Alpha" },
          { id: "p2", name: "" },
        ],
        activeProjectId: null,
        hrefFor,
      }),
    ).toEqual([]);
    // Two named + one unnamed → chips for the two named only.
    const chips = buildSiteProjectChips({
      projects: [...PROJECTS, { id: "p3", name: "" }],
      activeProjectId: null,
      hrefFor,
    });
    expect(chips.map((c) => c.label)).toEqual([ALL_PROJECTS_OPTION_LABEL, "Alpha", "Beta"]);
  });
});

describe("SiteProjectChips", () => {
  it("renders nothing for an empty chip set", () => {
    const { container } = render(<SiteProjectChips chips={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a labeled group of chip links with aria-current on the active one", () => {
    const chips = buildSiteProjectChips({ projects: PROJECTS, activeProjectId: "p1", hrefFor });
    render(<SiteProjectChips chips={chips} />);
    const group = screen.getByRole("group", { name: PROJECT_FILTER_ARIA });
    expect(group).toBeInTheDocument();
    const all = screen.getByRole("link", { name: ALL_PROJECTS_OPTION_LABEL });
    expect(all).toHaveAttribute("href", "/requests");
    expect(all).not.toHaveAttribute("aria-current");
    const alpha = screen.getByRole("link", { name: "Alpha" });
    expect(alpha).toHaveAttribute("href", "/requests?project=p1");
    expect(alpha).toHaveAttribute("aria-current", "true");
  });
});
