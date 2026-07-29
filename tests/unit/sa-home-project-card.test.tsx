// Writing failing test first.
//
// Spec 375 U2 — the SA home's project block.
//
// Measured defect: `CurrentProjectSwitcher` renders nothing below 2 projects and
// ALL 5 site admins are on exactly 1 project, so the home carried no link to the
// SA's own project at all. 395 of ~810 home visits leaked sideways into
// /projects (a 4-item list, 3 of them with zero open WPs) to reach the hub.
//
// The builder is pure so the selection + count logic is testable without a page
// render; the card is a plain Link so RTL can drive it (unlike /sa itself, which
// is a Server Component vitest cannot render).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildHomeProjectCard, type HomeProjectWp } from "@/lib/sa/home-project-card";
import { HomeProjectCard } from "@/components/features/sa/home-project-card";

const VISIBLE = [
  {
    id: "p1",
    code: "PRC-2026-004",
    name: "TFM โพธิ์ทอง",
    isPrimary: true,
    addedAt: null,
    hasMembership: true,
  },
  {
    id: "p2",
    code: "PRC-2026-005",
    name: "บ้านพักอาศัย",
    isPrimary: false,
    addedAt: null,
    hasMembership: true,
  },
];

function wp(id: string, project_id: string): HomeProjectWp {
  return { id, project_id };
}

describe("buildHomeProjectCard (spec 375 U2)", () => {
  it("returns the resolved current project with its open-WP count", () => {
    const card = buildHomeProjectCard({
      current: { projectId: "p1", source: "primary" },
      visibleProjects: VISIBLE,
      wps: [wp("a", "p1"), wp("b", "p1"), wp("c", "p2")],
    });
    expect(card).toEqual({
      projectId: "p1",
      code: "PRC-2026-004",
      name: "TFM โพธิ์ทอง",
      openCount: 2,
    });
  });

  it("counts ONLY the current project's work packages", () => {
    const card = buildHomeProjectCard({
      current: { projectId: "p2", source: "override" },
      visibleProjects: VISIBLE,
      wps: [wp("a", "p1"), wp("b", "p1"), wp("c", "p2")],
    });
    expect(card?.openCount).toBe(1);
  });

  it("renders nothing when the SA has no resolved project", () => {
    expect(
      buildHomeProjectCard({
        current: { projectId: null, source: "none" },
        visibleProjects: [],
        wps: [],
      }),
    ).toBeNull();
  });

  it("drops a current id that is not in the visible list", () => {
    // Forge-safety parity with the resolver (spec 292): a cookie naming a
    // project outside the RLS-visible set grants nothing. Rendering its id would
    // leak a project reference the caller cannot open.
    expect(
      buildHomeProjectCard({
        current: { projectId: "ghost", source: "override" },
        visibleProjects: VISIBLE,
        wps: [],
      }),
    ).toBeNull();
  });

  it("reports zero for a project with no open work", () => {
    const card = buildHomeProjectCard({
      current: { projectId: "p1", source: "primary" },
      visibleProjects: VISIBLE,
      wps: [wp("c", "p2")],
    });
    expect(card?.openCount).toBe(0);
  });
});

describe("<HomeProjectCard> (spec 375 U2)", () => {
  const card = { projectId: "p1", code: "PRC-2026-004", name: "TFM โพธิ์ทอง", openCount: 176 };

  it("links to the project hub", () => {
    render(<HomeProjectCard card={card} />);
    const link = screen.getByRole("link");
    // The whole point of the unit: one tap from the home to her own project.
    expect(link).toHaveAttribute("href", "/projects/p1");
  });

  it("names the project and its open-work count", () => {
    render(<HomeProjectCard card={card} />);
    expect(screen.getByText("TFM โพธิ์ทอง")).toBeInTheDocument();
    expect(screen.getByText(/176/)).toBeInTheDocument();
    expect(screen.getByText(/PRC-2026-004/)).toBeInTheDocument();
  });

  it("renders nothing when there is no card", () => {
    const { container } = render(<HomeProjectCard card={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still renders the door when the project has no open work", () => {
    // A zero count must not suppress the link — an SA whose work is all done
    // still needs to reach her project, and this is the ONLY door on the home.
    render(<HomeProjectCard card={{ ...card, openCount: 0 }} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/projects/p1");
  });
});
