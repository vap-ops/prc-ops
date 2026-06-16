// Spec 130 U3 — the claim-invite RPC errors mapped to contractor-facing Thai.
// The RPC raises distinct messages (claim_contractor_invite); the portal shows
// a human reason, never the raw error.

import { describe, it, expect } from "vitest";
import { claimErrorToThai } from "@/lib/portal/claim-error";

describe("claimErrorToThai", () => {
  it("maps each known RPC error to a distinct Thai message", () => {
    expect(claimErrorToThai("claim_contractor_invite: only a visitor may claim")).toMatch(
      /ภายในระบบ/,
    );
    expect(claimErrorToThai("claim_contractor_invite: already bound")).toMatch(
      /ผูกกับผู้รับเหมาแล้ว/,
    );
    expect(claimErrorToThai("claim_contractor_invite: token already used")).toMatch(/ใช้ไปแล้ว/);
    expect(claimErrorToThai("claim_contractor_invite: token expired")).toMatch(/หมดอายุ/);
    expect(claimErrorToThai("claim_contractor_invite: invalid token")).toMatch(/ไม่ถูกต้อง/);
  });

  it("falls back to a generic message for an unknown error", () => {
    const msg = claimErrorToThai("some unexpected failure");
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/ไม่สำเร็จ/);
  });
});
