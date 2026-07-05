// Spec 263 U2 / spec 264 G1+G2 — the applicant-uploadable staff_doc_purpose set:
// exactly the two enum values (id_card / profile_photo). `consent` was dropped —
// PDPA consent is now an in-app record (staff_consents), not a document upload.
// Pure; mirrors portal/document-types.ts's shape.

import { describe, it, expect } from "vitest";
import {
  STAFF_DOC_PURPOSES,
  STAFF_DOC_LABELS,
  isStaffDocPurpose,
} from "@/lib/register/document-types";

describe("staff registration document types", () => {
  it("offers exactly the two purposes (consent dropped)", () => {
    expect([...STAFF_DOC_PURPOSES]).toEqual(["id_card", "profile_photo"]);
  });

  it("has a non-empty Thai label for every purpose", () => {
    for (const p of STAFF_DOC_PURPOSES) {
      expect(STAFF_DOC_LABELS[p]).toBeTruthy();
    }
  });

  it("guards the staff-uploadable purposes", () => {
    expect(isStaffDocPurpose("id_card")).toBe(true);
    expect(isStaffDocPurpose("profile_photo")).toBe(true);
  });

  it("rejects unknown purposes and junk (incl. the retired consent)", () => {
    expect(isStaffDocPurpose("consent")).toBe(false);
    expect(isStaffDocPurpose("bank_book")).toBe(false);
    expect(isStaffDocPurpose("nope")).toBe(false);
    expect(isStaffDocPurpose(null)).toBe(false);
    expect(isStaffDocPurpose(123)).toBe(false);
  });
});
