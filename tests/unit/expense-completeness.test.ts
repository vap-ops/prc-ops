// Spec 285 U2 — a site expense is only "complete" once BOTH an item photo
// (reference attachment) and an accounting doc (invoice attachment) are attached.
// Attachments are architecturally post-create, so completeness is derived from
// their presence at the form/completion layer (no schema).

import { describe, expect, it } from "vitest";
import { isExpenseComplete } from "@/lib/purchasing/expense-completeness";

describe("isExpenseComplete", () => {
  it("is complete only when both the item photo and the accounting doc are present", () => {
    expect(isExpenseComplete({ hasItemPhoto: true, hasAccountingDoc: true })).toBe(true);
  });

  it("is incomplete with only the item photo", () => {
    expect(isExpenseComplete({ hasItemPhoto: true, hasAccountingDoc: false })).toBe(false);
  });

  it("is incomplete with only the accounting doc", () => {
    expect(isExpenseComplete({ hasItemPhoto: false, hasAccountingDoc: true })).toBe(false);
  });

  it("is incomplete with neither", () => {
    expect(isExpenseComplete({ hasItemPhoto: false, hasAccountingDoc: false })).toBe(false);
  });
});
