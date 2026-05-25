// Pure tests for the status-color helper used by the SA project list and
// the SA WP list. The helper maps an enum value → Tailwind pill classes
// using the same zinc / amber / emerald / muted palette already used by
// the PM-side pills (approval decisions, report statuses), so the two
// surfaces stay visually consistent.
//
// Test shape: every enum label produces a non-empty class string; an
// unknown value falls back to the neutral default; the helper is
// exhaustive on the two enums (driven by the Constants table from the
// generated database.types.ts so adding a new enum value would surface
// here).

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { Constants } from "@/lib/db/database.types";
import { projectStatusPillClasses, workPackageStatusPillClasses } from "@/lib/status-colors";

describe("projectStatusPillClasses", () => {
  for (const value of Constants.public.Enums.project_status) {
    it(`returns a non-empty class string for project_status='${value}'`, () => {
      const classes = projectStatusPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("falls back to neutral classes for an unknown value", () => {
    // We narrow with `as unknown as` because the helper accepts the
    // typed union; the test is for the runtime default path the
    // helper exposes for defensive use.
    const unknown = "totally-not-a-status" as unknown as Parameters<
      typeof projectStatusPillClasses
    >[0];
    const classes = projectStatusPillClasses(unknown);
    expect(typeof classes).toBe("string");
    expect(classes.length).toBeGreaterThan(0);
  });

  it("uses the emerald palette for 'completed' (positive terminal)", () => {
    expect(projectStatusPillClasses("completed")).toContain("emerald");
  });

  it("uses the amber palette for 'on_hold' (needs attention)", () => {
    expect(projectStatusPillClasses("on_hold")).toContain("amber");
  });
});

describe("workPackageStatusPillClasses", () => {
  for (const value of Constants.public.Enums.work_package_status) {
    it(`returns a non-empty class string for work_package_status='${value}'`, () => {
      const classes = workPackageStatusPillClasses(value);
      expect(typeof classes).toBe("string");
      expect(classes.length).toBeGreaterThan(0);
    });
  }

  it("falls back to neutral classes for an unknown value", () => {
    const unknown = "not-a-wp-status" as unknown as Parameters<
      typeof workPackageStatusPillClasses
    >[0];
    const classes = workPackageStatusPillClasses(unknown);
    expect(typeof classes).toBe("string");
    expect(classes.length).toBeGreaterThan(0);
  });

  it("uses the emerald palette for 'complete' (positive terminal)", () => {
    expect(workPackageStatusPillClasses("complete")).toContain("emerald");
  });

  it("uses the amber palette for in-flight WP statuses (in_progress, on_hold, pending_approval)", () => {
    expect(workPackageStatusPillClasses("in_progress")).toContain("amber");
    expect(workPackageStatusPillClasses("on_hold")).toContain("amber");
    expect(workPackageStatusPillClasses("pending_approval")).toContain("amber");
  });

  it("uses the zinc palette for 'not_started' (idle default)", () => {
    expect(workPackageStatusPillClasses("not_started")).toContain("zinc");
  });
});
