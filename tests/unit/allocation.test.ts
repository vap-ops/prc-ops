// Spec 146 U2 §Tests (TDD, RED first) — pure validation for an
// equipment_project_allocations row (committing a rental batch to a project
// for a period). The UI gate before create_equipment_project_allocation; the
// RPC + DB CHECK (ends_on >= starts_on) re-guard. Dates are ISO YYYY-MM-DD
// compared lexicographically (= chronological); no Date parsing.

import { describe, it, expect } from "vitest";
import { validateAllocation } from "@/lib/equipment/validate-allocation";

function input(over: Partial<Parameters<typeof validateAllocation>[0]> = {}) {
  return {
    startsOn: "2026-07-01",
    endsOn: null as string | null,
    ...over,
  };
}

describe("validateAllocation", () => {
  it("accepts an open-ended allocation (no end date)", () => {
    const r = validateAllocation(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.startsOn).toBe("2026-07-01");
      expect(r.value.endsOn).toBeNull();
    }
  });

  it("accepts a closed allocation with ends_on >= starts_on", () => {
    const r = validateAllocation(input({ endsOn: "2026-09-30" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.endsOn).toBe("2026-09-30");
  });

  it("accepts ends_on equal to starts_on", () => {
    expect(validateAllocation(input({ endsOn: "2026-07-01" })).ok).toBe(true);
  });

  it("normalizes blank end date to null", () => {
    const r = validateAllocation(input({ endsOn: "" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.endsOn).toBeNull();
  });

  it("rejects a missing start date", () => {
    expect(validateAllocation(input({ startsOn: "" })).ok).toBe(false);
  });

  it("rejects a malformed start date", () => {
    expect(validateAllocation(input({ startsOn: "01-07-2026" })).ok).toBe(false);
  });

  it("rejects ends_on before starts_on", () => {
    const r = validateAllocation(input({ startsOn: "2026-07-01", endsOn: "2026-06-30" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ก่อนวันเริ่ม");
  });

  it("rejects a malformed end date", () => {
    expect(validateAllocation(input({ endsOn: "2026-13-40" })).ok).toBe(false);
  });
});
