// Writing failing test first.
//
// Operator 2026-07-06: the single-project site_admin → /projects/[id] landing was
// REVERTED. /sa is now the SA daily home (งานของฉัน + แผนวันนี้ + the แผนพรุ่งนี้
// board + one-tap มาทำ); a single-project SA who landed on the bare project hub
// never saw the board (spec 273 discoverability). Landing is now pure role-only:
// resolveHomePath === roleHome. Every role — site_admin included — lands on its
// role home regardless of project count.

import { describe, expect, it } from "vitest";

import { resolveHomePath } from "@/lib/auth/resolve-home";

describe("resolveHomePath (role-only landing; single-project SA rule reverted)", () => {
  it("lands a site_admin on /sa (the daily home), not their project", () => {
    expect(resolveHomePath("site_admin")).toBe("/sa");
  });

  it("lands each other role on its roleHome", () => {
    expect(resolveHomePath("project_manager")).toBe("/dashboard");
    expect(resolveHomePath("super_admin")).toBe("/dashboard");
    expect(resolveHomePath("procurement")).toBe("/requests");
  });
});
