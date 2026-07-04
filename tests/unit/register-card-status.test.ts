// Spec 263 U2 — the e-employee card's status badge is a pure render of
// technician_registrations.status: pending -> "รออนุมัติ" (with a distinct
// waiting glyph), approved -> "อนุมัติแล้ว" (with a distinct done glyph). One
// pure mapper, both card states (the card component is a render, not stored
// state, per the spec).

import { describe, it, expect } from "vitest";
import { registrationStatusBadge, resolveCardPhoto } from "@/lib/register/card-view";

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

// Spec 263 follow-up — operator: the e-card's default image should be the
// user's LINE profile photo, not a blank placeholder, until they upload their
// own. Pure resolution order: uploaded profile_photo signed URL wins → else
// users.line_avatar_url → else null (the card's own placeholder renders on
// null, unchanged).
describe("resolveCardPhoto", () => {
  it("prefers the uploaded profile photo over the LINE avatar", () => {
    expect(
      resolveCardPhoto("https://signed.example/profile.jpg", "https://line-cdn/avatar.jpg"),
    ).toBe("https://signed.example/profile.jpg");
  });

  it("falls back to the LINE avatar when no profile photo is uploaded", () => {
    expect(resolveCardPhoto(null, "https://line-cdn/avatar.jpg")).toBe(
      "https://line-cdn/avatar.jpg",
    );
  });

  it("returns null when neither is available (placeholder renders)", () => {
    expect(resolveCardPhoto(null, null)).toBeNull();
  });
});
