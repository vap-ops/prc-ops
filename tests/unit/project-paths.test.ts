// Writing failing test first.
//
// Spec 82 Unit 1 — the project detail surfaces move out of the role-named
// /sa namespace into the content-named /projects namespace (the URL names
// what is shown, never the viewer's role — operator 2026-06-14: "pm lands
// on sa"). These builders are the single source of project-surface URLs;
// the scattered inline `/sa/projects/${id}` template literals that let the
// role prefix leak everywhere are replaced by calls to them, so a future
// route move touches one file. Reports keeps its /pm/... home until Unit 2,
// so it has no builder here yet.

import { describe, expect, it } from "vitest";

import { projectHref, projectSettingsHref, workPackageHref } from "@/lib/nav/project-paths";

describe("project-paths builders", () => {
  it("projectHref points at the content-named project page (no /sa)", () => {
    expect(projectHref("p1")).toBe("/projects/p1");
  });

  it("workPackageHref nests the WP detail under the project", () => {
    expect(workPackageHref("p1", "wp9")).toBe("/projects/p1/work-packages/wp9");
  });

  it("projectSettingsHref nests settings under the project", () => {
    expect(projectSettingsHref("p1")).toBe("/projects/p1/settings");
  });

  it("never emits the old role-named /sa/projects prefix", () => {
    expect(projectHref("x")).not.toMatch(/\/sa\//);
    expect(workPackageHref("x", "y")).not.toMatch(/\/sa\//);
    expect(projectSettingsHref("x")).not.toMatch(/\/sa\//);
  });
});
