// Spec 131 U2c — the curated set of documents a DC may upload from /portal (a
// subset of contact_doc_purpose). Pure; the portal uploader offers exactly these,
// and the own-doc server action validates against them. company_cert/vat_cert are
// PM-collected (presence-only in the completeness card), so they are NOT here.

import { describe, it, expect } from "vitest";
import {
  PORTAL_DOC_PURPOSES,
  PORTAL_DOC_LABELS,
  isPortalDocPurpose,
} from "@/lib/portal/document-types";

describe("portal document types", () => {
  it("offers exactly the five DC-uploadable purposes", () => {
    expect([...PORTAL_DOC_PURPOSES]).toEqual([
      "id_card",
      "bank_book",
      "consent",
      "house_registration",
      "insurance",
    ]);
  });

  it("has a non-empty Thai label for every purpose", () => {
    for (const p of PORTAL_DOC_PURPOSES) {
      expect(PORTAL_DOC_LABELS[p]).toBeTruthy();
    }
  });

  it("guards the DC-uploadable purposes", () => {
    expect(isPortalDocPurpose("id_card")).toBe(true);
    expect(isPortalDocPurpose("insurance")).toBe(true);
  });

  it("rejects company docs (PM-collected, not DC-uploadable) and junk", () => {
    expect(isPortalDocPurpose("company_cert")).toBe(false);
    expect(isPortalDocPurpose("vat_cert")).toBe(false);
    expect(isPortalDocPurpose("contract")).toBe(false);
    expect(isPortalDocPurpose("nope")).toBe(false);
    expect(isPortalDocPurpose(null)).toBe(false);
    expect(isPortalDocPurpose(123)).toBe(false);
  });
});
