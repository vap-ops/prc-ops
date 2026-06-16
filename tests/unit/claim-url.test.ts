// Spec 130 U5 — the PM-issued portal invite link. Pure builder so the claim URL
// shape lives in one place and matches the /portal/claim route (token query param).

import { describe, it, expect } from "vitest";
import { buildClaimUrl } from "@/lib/portal/claim-url";

describe("buildClaimUrl", () => {
  it("builds {origin}/portal/claim?token={token}", () => {
    expect(buildClaimUrl("https://app.example.com", "abc123")).toBe(
      "https://app.example.com/portal/claim?token=abc123",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildClaimUrl("https://app.example.com/", "abc123")).toBe(
      "https://app.example.com/portal/claim?token=abc123",
    );
  });

  it("url-encodes the token", () => {
    expect(buildClaimUrl("https://app.example.com", "a b/c")).toBe(
      "https://app.example.com/portal/claim?token=a%20b%2Fc",
    );
  });
});
