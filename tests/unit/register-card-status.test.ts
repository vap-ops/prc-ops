// Spec 263 U2 — the e-employee card's status badge is a pure render of
// technician_registrations.status: pending -> "รออนุมัติ" (with a distinct
// waiting glyph), approved -> "อนุมัติแล้ว" (with a distinct done glyph). One
// pure mapper, both card states (the card component is a render, not stored
// state, per the spec).

import { describe, it, expect } from "vitest";
import { registrationStatusBadge } from "@/lib/register/card-view";

describe("registrationStatusBadge", () => {
  it("renders the pending badge", () => {
    const badge = registrationStatusBadge("pending");
    expect(badge.label).toBe("รออนุมัติ");
    expect(badge.tone).toBe("pending");
  });

  it("renders the approved badge", () => {
    const badge = registrationStatusBadge("approved");
    expect(badge.label).toBe("อนุมัติแล้ว");
    expect(badge.tone).toBe("approved");
  });

  it("renders the rejected badge", () => {
    const badge = registrationStatusBadge("rejected");
    expect(badge.label).toBe("ถูกปฏิเสธ");
    expect(badge.tone).toBe("rejected");
  });
});
