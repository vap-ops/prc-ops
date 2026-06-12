// Unit tests for the pure on-hold toggle helpers (spec 52). The server
// action wiring is thin glue over these predicates plus the existing
// RLS posture (work_packages UPDATE admits pm/super only).

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  HOLDABLE_FROM_STATUSES,
  canHold,
  canRelease,
  deriveReleaseStatus,
} from "@/lib/work-packages/hold";

const ALL_STATUSES = [
  "not_started",
  "in_progress",
  "on_hold",
  "pending_approval",
  "complete",
] as const;

describe("canHold", () => {
  it("allows hold from not_started and in_progress only", () => {
    for (const status of ALL_STATUSES) {
      expect(canHold(status)).toBe(status === "not_started" || status === "in_progress");
    }
  });

  it("refuses pending_approval — pausing a queued WP is done by deciding, not hiding", () => {
    expect(canHold("pending_approval")).toBe(false);
  });

  it("HOLDABLE_FROM_STATUSES mirrors the predicate (the SQL guard reuses this list)", () => {
    expect([...HOLDABLE_FROM_STATUSES].sort()).toEqual(["in_progress", "not_started"]);
  });
});

describe("canRelease", () => {
  it("allows release from on_hold only", () => {
    for (const status of ALL_STATUSES) {
      expect(canRelease(status)).toBe(status === "on_hold");
    }
  });
});

describe("deriveReleaseStatus", () => {
  it("returns in_progress when current During photos exist", () => {
    expect(deriveReleaseStatus(true)).toBe("in_progress");
  });

  it("returns not_started when none exist (in_progress means During photos exist, spec 52)", () => {
    expect(deriveReleaseStatus(false)).toBe("not_started");
  });
});
