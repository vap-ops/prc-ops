// Spec 263 U2 — the applicant-uploadable technician_doc_purpose set: exactly the
// three enum values (id_card / consent / profile_photo). Pure; mirrors
// portal/document-types.ts's shape.

import { describe, it, expect } from "vitest";
import {
  TECHNICIAN_DOC_PURPOSES,
  TECHNICIAN_DOC_LABELS,
  isTechnicianDocPurpose,
} from "@/lib/register/document-types";

describe("technician registration document types", () => {
  it("offers exactly the three purposes", () => {
    expect([...TECHNICIAN_DOC_PURPOSES]).toEqual(["id_card", "consent", "profile_photo"]);
  });

  it("has a non-empty Thai label for every purpose", () => {
    for (const p of TECHNICIAN_DOC_PURPOSES) {
      expect(TECHNICIAN_DOC_LABELS[p]).toBeTruthy();
    }
  });

  it("guards the technician-uploadable purposes", () => {
    expect(isTechnicianDocPurpose("id_card")).toBe(true);
    expect(isTechnicianDocPurpose("consent")).toBe(true);
    expect(isTechnicianDocPurpose("profile_photo")).toBe(true);
  });

  it("rejects unknown purposes and junk", () => {
    expect(isTechnicianDocPurpose("bank_book")).toBe(false);
    expect(isTechnicianDocPurpose("nope")).toBe(false);
    expect(isTechnicianDocPurpose(null)).toBe(false);
    expect(isTechnicianDocPurpose(123)).toBe(false);
  });
});
