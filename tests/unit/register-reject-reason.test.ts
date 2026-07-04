// Writing failing test first.
//
// Spec 263 U3 — reject requires a reason (spec doc §RPCs: reject_technician_registration
// takes p_reason; the U3 brief: "Reject requires a reason"). Pure validation,
// mirrors registration-profile.ts's shape/UX (trim, length cap, Thai message).

import { describe, it, expect } from "vitest";
import { validateRejectReason } from "@/lib/register/reject-reason";

describe("validateRejectReason", () => {
  it("rejects an empty reason", () => {
    expect(validateRejectReason("")).toMatch(/ระบุเหตุผล/);
  });

  it("rejects a whitespace-only reason", () => {
    expect(validateRejectReason("   ")).toMatch(/ระบุเหตุผล/);
  });

  it("accepts a real reason", () => {
    expect(validateRejectReason("เอกสารไม่ครบ")).toBeNull();
  });

  it("rejects a reason over the length cap", () => {
    expect(validateRejectReason("a".repeat(501))).toMatch(/ยาวเกินไป/);
  });

  it("accepts a reason right at the cap", () => {
    expect(validateRejectReason("a".repeat(500))).toBeNull();
  });
});
