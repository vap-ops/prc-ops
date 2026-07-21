// Writing failing test first.
//
// Spec 333 U2 — deferredDocsOwed: the pure derive for the post-approval
// docs-owed view. Only an APPROVED registration whose approval deferred the
// document floors (documents_deferred_at set) owes anything; the owed set is
// exactly the missing document floors (id_card photo, book_bank photo, bank
// fields row) — full_name + PDPA were enforced before approval and can never
// be owed here. Mirrors the mig-075822 RPC carve; the RPC stays authoritative.

import { describe, expect, it } from "vitest";
import { deferredDocsOwed } from "@/lib/register/docs-owed";

const BASE = {
  status: "approved" as const,
  documentsDeferredAt: "2026-07-21T04:00:00Z",
  hasIdCard: false,
  hasBookBank: false,
  hasBankFields: false,
};

describe("deferredDocsOwed (spec 333 U2)", () => {
  it("owes all three documents right after a deferred approval", () => {
    expect(deferredDocsOwed(BASE)).toEqual(["id_card", "book_bank", "bank_fields"]);
  });

  it("shrinks as documents arrive", () => {
    expect(deferredDocsOwed({ ...BASE, hasIdCard: true })).toEqual(["book_bank", "bank_fields"]);
    expect(deferredDocsOwed({ ...BASE, hasIdCard: true, hasBookBank: true })).toEqual([
      "bank_fields",
    ]);
  });

  it("owes nothing once everything arrived", () => {
    expect(
      deferredDocsOwed({ ...BASE, hasIdCard: true, hasBookBank: true, hasBankFields: true }),
    ).toEqual([]);
  });

  it("owes nothing on an approved row WITHOUT the deferral stamp", () => {
    expect(deferredDocsOwed({ ...BASE, documentsDeferredAt: null })).toEqual([]);
  });

  it("owes nothing while still pending (the form owns the pending checklist)", () => {
    expect(deferredDocsOwed({ ...BASE, status: "pending" })).toEqual([]);
  });

  it("owes nothing on a rejected row", () => {
    expect(deferredDocsOwed({ ...BASE, status: "rejected" })).toEqual([]);
  });
});
