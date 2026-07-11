// Spec 263 U2 / spec 264 G1+G2 / spec 296 — the applicant-uploadable
// staff_doc_purpose set: id_card / book_bank / profile_photo. `consent` was
// dropped (PDPA consent is an in-app staff_consents record); book_bank (bank
// passbook photo) was added by spec 296. Pure; mirrors portal/document-types.ts.

import { describe, it, expect } from "vitest";
import {
  STAFF_DOC_PURPOSES,
  STAFF_DOC_LABELS,
  isStaffDocPurpose,
} from "@/lib/register/document-types";

describe("staff registration document types", () => {
  it("offers exactly the three purposes (consent dropped, book_bank added)", () => {
    expect([...STAFF_DOC_PURPOSES]).toEqual(["id_card", "book_bank", "profile_photo"]);
  });

  it("has a non-empty Thai label for every purpose", () => {
    for (const p of STAFF_DOC_PURPOSES) {
      expect(STAFF_DOC_LABELS[p]).toBeTruthy();
    }
  });

  it("guards the staff-uploadable purposes", () => {
    expect(isStaffDocPurpose("id_card")).toBe(true);
    expect(isStaffDocPurpose("book_bank")).toBe(true);
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
