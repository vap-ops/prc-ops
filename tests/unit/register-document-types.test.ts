// Spec 263 U2 / spec 264 G1 — the applicant-uploadable staff_doc_purpose set:
// exactly the two enum values (id_card / profile_photo). `consent` was dropped —
// PDPA consent is now an in-app record (staff_consents), not a document upload.
// Pure; mirrors portal/document-types.ts's shape.

import { describe, it, expect } from "vitest";
import {
  TECHNICIAN_DOC_PURPOSES,
  TECHNICIAN_DOC_LABELS,
  isTechnicianDocPurpose,
} from "@/lib/register/document-types";

describe("staff registration document types", () => {
  it("offers exactly the two purposes (consent dropped)", () => {
    expect([...TECHNICIAN_DOC_PURPOSES]).toEqual(["id_card", "profile_photo"]);
  });

  it("has a non-empty Thai label for every purpose", () => {
    for (const p of TECHNICIAN_DOC_PURPOSES) {
      expect(TECHNICIAN_DOC_LABELS[p]).toBeTruthy();
    }
  });

  it("guards the staff-uploadable purposes", () => {
    expect(isTechnicianDocPurpose("id_card")).toBe(true);
    expect(isTechnicianDocPurpose("profile_photo")).toBe(true);
  });

  it("rejects unknown purposes and junk (incl. the retired consent)", () => {
    expect(isTechnicianDocPurpose("consent")).toBe(false);
    expect(isTechnicianDocPurpose("bank_book")).toBe(false);
    expect(isTechnicianDocPurpose("nope")).toBe(false);
    expect(isTechnicianDocPurpose(null)).toBe(false);
    expect(isTechnicianDocPurpose(123)).toBe(false);
  });
});
