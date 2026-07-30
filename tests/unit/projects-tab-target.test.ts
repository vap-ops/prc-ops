// Writing failing test first.
//
// Spec 376 U1 — the SA's โครงการ tab target. The helper is pure: role +
// pathname + the optional /sa-resolved href in, the swap target (or null =
// keep the static /projects, whose redirect stays the fallback) out.
import { describe, expect, it } from "vitest";
import { saProjectsTabHref } from "@/lib/nav/projects-tab-target";

const UUID = "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9";

describe("saProjectsTabHref", () => {
  it("prefers the explicit prop (the /sa mount)", () => {
    expect(
      saProjectsTabHref({
        role: "site_admin",
        pathname: "/sa",
        projectsTabHref: `/projects/${UUID}`,
      }),
    ).toBe(`/projects/${UUID}`);
  });

  it("derives the project root from a project-world pathname", () => {
    expect(
      saProjectsTabHref({
        role: "site_admin",
        pathname: `/projects/${UUID}/work-packages/${UUID}`,
      }),
    ).toBe(`/projects/${UUID}`);
  });

  it("returns null on the hub itself (bare /projects, incl. ?view=all pathname)", () => {
    expect(saProjectsTabHref({ role: "site_admin", pathname: "/projects" })).toBeNull();
  });

  it("returns null for every non-SA role even with a prop", () => {
    expect(
      saProjectsTabHref({
        role: "project_manager",
        pathname: `/projects/${UUID}`,
        projectsTabHref: `/projects/${UUID}`,
      }),
    ).toBeNull();
  });

  it("returns null off the project world with no prop", () => {
    expect(saProjectsTabHref({ role: "site_admin", pathname: "/team" })).toBeNull();
  });

  it("does not swap on a malformed id segment", () => {
    expect(saProjectsTabHref({ role: "site_admin", pathname: "/projects/not-a-uuid" })).toBeNull();
  });
});
