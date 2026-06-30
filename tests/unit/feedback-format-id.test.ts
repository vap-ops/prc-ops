import { describe, it, expect } from "vitest";

import { formatFeedbackNumber } from "@/lib/feedback/format-id";

describe("formatFeedbackNumber", () => {
  it("zero-pads to 4 digits with the FB- prefix", () => {
    expect(formatFeedbackNumber(7)).toBe("FB-0007");
    expect(formatFeedbackNumber(30)).toBe("FB-0030");
    expect(formatFeedbackNumber(123)).toBe("FB-0123");
  });

  it("does not truncate numbers beyond 4 digits", () => {
    expect(formatFeedbackNumber(12345)).toBe("FB-12345");
  });

  it("treats null / undefined as 0 (mirrors the PR/PO formatter)", () => {
    expect(formatFeedbackNumber(null)).toBe("FB-0000");
    expect(formatFeedbackNumber(undefined)).toBe("FB-0000");
  });
});
