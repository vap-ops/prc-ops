// Spec 23 (spec 16 §4 contract) — link validation for purchase-request
// attachments. Thai error copy pinned per spec-14 discipline.

import { describe, expect, it } from "vitest";

import { validateAttachmentLink } from "@/lib/purchasing/validate-attachment";

describe("validateAttachmentLink (spec 23)", () => {
  it("accepts http(s) urls and trims whitespace", () => {
    expect(validateAttachmentLink("  https://example.com/quote.pdf  ")).toEqual({
      ok: true,
      value: "https://example.com/quote.pdf",
    });
    expect(validateAttachmentLink("http://supplier.test/item")).toEqual({
      ok: true,
      value: "http://supplier.test/item",
    });
  });

  it("rejects non-http(s) schemes and bare hosts with the pinned Thai copy", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.test", "example.com"]) {
      const result = validateAttachmentLink(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://");
      }
    }
  });

  it("rejects empty and over-length urls", () => {
    expect(validateAttachmentLink("   ").ok).toBe(false);
    expect(validateAttachmentLink(`https://x.test/${"a".repeat(2048)}`).ok).toBe(false);
  });
});
