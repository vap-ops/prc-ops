import { describe, expect, it } from "vitest";

import { prProjectId } from "@/lib/purchasing/pr-project-id";

// Spec 208 U4a made every manually-created purchase request store-bound:
// work_package_id is null and the scope lives on the PR's own project_id
// (NOT NULL since spec 195 P1). The attachment paths previously derived the
// project ONLY via the work package, so a store-bound PR yielded null and every
// attachment (invoice / payment proof / delivery photo) failed. The project must
// come from project_id, falling back to the WP join only as belt-and-braces.
describe("prProjectId — the project a purchase request belongs to", () => {
  it("uses the PR's own project_id for a store-bound (WP-less) PR", () => {
    expect(prProjectId({ project_id: "p1", work_packages: null })).toBe("p1");
  });

  it("returns the project for a WP-bound PR", () => {
    expect(prProjectId({ project_id: "p1", work_packages: { project_id: "p1" } })).toBe("p1");
  });

  it("falls back to the WP join when project_id is somehow absent", () => {
    expect(prProjectId({ project_id: null, work_packages: { project_id: "p2" } })).toBe("p2");
  });

  it("returns null when neither is present", () => {
    expect(prProjectId({ project_id: null, work_packages: null })).toBeNull();
  });

  it("returns null for a missing PR", () => {
    expect(prProjectId(null)).toBeNull();
  });
});
