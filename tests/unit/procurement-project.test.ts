// Writing failing test first.
//
// Spec 327 U1 — the procurement selection resolver (pure). The dashboard's
// project cards ARE the selection; the choice persists in the
// procurement_project httpOnly cookie and every S/T/R view resolves it through
// this one function. Blueprint: src/lib/sa/current-project.ts (spec 292 — same
// validate-against-visible + sole-project semantics). Forge-safety: a cookie
// naming a project outside the caller's RLS-visible list is dropped, never
// trusted — stale/garbage falls back to ทุกโครงการ (§0.4: selection must never
// strand the user on an invalid lens).

import { describe, expect, it } from "vitest";

import {
  PROCUREMENT_PROJECT_COOKIE,
  resolveSelectedProject,
} from "@/lib/purchasing/procurement-project";

const VISIBLE = ["p1", "p2", "p3"];

describe("PROCUREMENT_PROJECT_COOKIE", () => {
  it("is the procurement_project cookie name (server half + actions share it)", () => {
    expect(PROCUREMENT_PROJECT_COOKIE).toBe("procurement_project");
  });
});

describe("resolveSelectedProject", () => {
  it("returns the cookie's project when it names a visible project", () => {
    expect(resolveSelectedProject("p2", VISIBLE)).toBe("p2");
  });

  it("drops a stale/garbage cookie value → null (ทุกโครงการ, §0.4 — never strand)", () => {
    expect(resolveSelectedProject("gone-project", VISIBLE)).toBeNull();
    expect(resolveSelectedProject("<script>", VISIBLE)).toBeNull();
  });

  it("returns null when no cookie is set and several projects are visible", () => {
    expect(resolveSelectedProject(null, VISIBLE)).toBeNull();
  });

  it("auto-selects the sole visible project (zero-cost selection, §0.4)", () => {
    expect(resolveSelectedProject(null, ["only"])).toBe("only");
  });

  it("auto-selects the sole visible project even over a stale cookie", () => {
    expect(resolveSelectedProject("gone-project", ["only"])).toBe("only");
  });

  it("returns null for zero visible projects", () => {
    expect(resolveSelectedProject(null, [])).toBeNull();
    expect(resolveSelectedProject("p1", [])).toBeNull();
  });
});
