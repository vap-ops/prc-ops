import { describe, it, expect } from "vitest";
import { buildExpenseAttachmentPath } from "@/lib/expenses/attachment-path";

const E = "11111111-1111-1111-1111-111111111111";
const A = "22222222-2222-2222-2222-222222222222";

describe("buildExpenseAttachmentPath", () => {
  it("builds {expense}/{attachment}.{ext}", () => {
    expect(buildExpenseAttachmentPath(E, A, "jpeg")).toBe(`${E}/${A}.jpeg`);
    expect(buildExpenseAttachmentPath(E, A, "pdf")).toBe(`${E}/${A}.pdf`);
  });

  it("returns null for a bad uuid", () => {
    expect(buildExpenseAttachmentPath("nope", A, "jpeg")).toBeNull();
    expect(buildExpenseAttachmentPath(E, "nope", "jpeg")).toBeNull();
  });

  it("returns null for an unsupported ext", () => {
    expect(buildExpenseAttachmentPath(E, A, "exe" as never)).toBeNull();
  });
});
