// Spec 193 — in-app feedback (bug report / feature request). Pure shape/UX
// validation for the form; the submit RPC re-guards + the table CHECKs enforce
// lengths. Thai, user-facing.

import { describe, it, expect } from "vitest";
import { validateFeedback } from "@/lib/feedback/validate";

function input(over: Partial<Parameters<typeof validateFeedback>[0]> = {}) {
  return {
    type: "bug" as const,
    title: "ปุ่มบันทึกกดไม่ได้",
    body: "กดแล้วไม่มีอะไรเกิดขึ้น",
    ...over,
  };
}

describe("validateFeedback", () => {
  it("accepts a well-formed bug and a feature", () => {
    expect(validateFeedback(input())).toBeNull();
    expect(validateFeedback(input({ type: "feature" }))).toBeNull();
  });

  it("rejects an unknown type", () => {
    expect(validateFeedback(input({ type: "other" as never }))).not.toBeNull();
  });

  it("requires a title and a body", () => {
    expect(validateFeedback(input({ title: "  " }))).not.toBeNull();
    expect(validateFeedback(input({ body: "" }))).not.toBeNull();
  });

  it("rejects an over-long title / body / screen", () => {
    expect(validateFeedback(input({ title: "x".repeat(201) }))).not.toBeNull();
    expect(validateFeedback(input({ body: "x".repeat(4001) }))).not.toBeNull();
    expect(validateFeedback(input({ screen: "x".repeat(201) }))).not.toBeNull();
  });

  it("allows an absent / empty screen (optional)", () => {
    expect(validateFeedback(input({ screen: "" }))).toBeNull();
    expect(validateFeedback(input({ screen: "หน้ารายการงาน" }))).toBeNull();
  });
});
