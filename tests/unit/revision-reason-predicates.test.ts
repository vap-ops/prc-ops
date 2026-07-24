// Writing failing test first.
//
// Spec 355 — reject-evidence (needs_revision) carries a REQUIRED structured reason;
// the comment demotes to optional detail. reject-work (rejected) keeps its required
// comment. The predicates + the label SSOT drive the PM form and the recordDecision
// action, so they cannot drift.

import { describe, expect, it } from "vitest";
import { commentRequiredFor, revisionReasonRequiredFor } from "@/lib/approvals/predicates";
import { APPROVAL_REVISION_REASON_LABEL } from "@/lib/i18n/labels";

describe("spec 355 — comment vs reason requirement", () => {
  it("comment is required only for reject-work (rejected)", () => {
    expect(commentRequiredFor("rejected")).toBe(true);
    expect(commentRequiredFor("needs_revision")).toBe(false);
    expect(commentRequiredFor("approved")).toBe(false);
  });

  it("a structured reason is required only for reject-evidence (needs_revision)", () => {
    expect(revisionReasonRequiredFor("needs_revision")).toBe(true);
    expect(revisionReasonRequiredFor("rejected")).toBe(false);
    expect(revisionReasonRequiredFor("approved")).toBe(false);
  });

  it("labels the three reasons", () => {
    expect(APPROVAL_REVISION_REASON_LABEL.incomplete).toBe("รูปไม่ครบ");
    expect(APPROVAL_REVISION_REASON_LABEL.mismatch).toBe("รูปไม่ตรงกับงาน");
    expect(APPROVAL_REVISION_REASON_LABEL.premature).toBe("งานยังไม่เสร็จ");
  });
});
