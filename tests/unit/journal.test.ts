// Spec 149 U3 §Tests (TDD, RED first) — pure validation for a journal entry's
// lines (ADR 0057 decision 3): double-entry must balance. The UI gate before
// post_journal_entry; the post_journal_internal RPC re-guards (balance assert +
// is_postable per line + period P0002). Amounts are compared in integer cents to
// avoid float drift (0.1 + 0.2). Postable/account existence is a DB concern, not
// validated here.

import { describe, it, expect } from "vitest";
import { validateJournalLines, canReverseJournalEntry } from "@/lib/accounting/journal";

function line(over: Partial<Parameters<typeof validateJournalLines>[0][number]> = {}) {
  return { accountCode: "1110", debit: 0, credit: 0, ...over };
}

describe("validateJournalLines", () => {
  it("accepts a balanced two-line entry", () => {
    expect(
      validateJournalLines([
        line({ accountCode: "1110", debit: 100, credit: 0 }),
        line({ accountCode: "4100", debit: 0, credit: 100 }),
      ]).ok,
    ).toBe(true);
  });

  it("accepts a balanced multi-line split", () => {
    expect(
      validateJournalLines([
        line({ accountCode: "1400", debit: 70, credit: 0 }),
        line({ accountCode: "1300", debit: 30, credit: 0 }),
        line({ accountCode: "2100", debit: 0, credit: 100 }),
      ]).ok,
    ).toBe(true);
  });

  it("handles cent precision (0.1 + 0.2 == 0.3)", () => {
    expect(
      validateJournalLines([line({ debit: 0.1 }), line({ debit: 0.2 }), line({ credit: 0.3 })]).ok,
    ).toBe(true);
  });

  it("rejects fewer than two lines", () => {
    expect(validateJournalLines([line({ debit: 100 })]).ok).toBe(false);
  });

  it("rejects an unbalanced entry", () => {
    const r = validateJournalLines([line({ debit: 100 }), line({ credit: 90 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("เดบิต");
  });

  it("rejects a line with both debit and credit", () => {
    expect(validateJournalLines([line({ debit: 50, credit: 50 }), line({ credit: 100 })]).ok).toBe(
      false,
    );
  });

  it("rejects a line with neither debit nor credit", () => {
    expect(validateJournalLines([line({ debit: 100 }), line({ debit: 0, credit: 0 })]).ok).toBe(
      false,
    );
  });

  it("rejects a negative amount", () => {
    expect(validateJournalLines([line({ debit: -100 }), line({ credit: 100 })]).ok).toBe(false);
  });

  it("rejects a non-finite amount", () => {
    expect(validateJournalLines([line({ debit: Number.NaN }), line({ credit: 100 })]).ok).toBe(
      false,
    );
  });

  it("rejects a blank account code", () => {
    expect(
      validateJournalLines([line({ accountCode: "", debit: 100 }), line({ credit: 100 })]).ok,
    ).toBe(false);
  });
});

// Spec G8 §Tests (TDD, RED first) — the reverse predicate gates the "กลับรายการ"
// control. It mirrors the reverse_journal_entry RPC guard: only a posted entry
// that has not already been reversed may be reversed. The original entry stays
// 'posted' after reversal (append-only — a mirror entry is inserted, the original
// is never UPDATEd), so reversibility cannot key on status alone; the loader
// passes whether a reversal already points back at the entry.
describe("canReverseJournalEntry", () => {
  it("allows reversing a posted entry that is not yet reversed", () => {
    expect(canReverseJournalEntry("posted", false)).toBe(true);
  });

  it("refuses a posted entry that is already reversed", () => {
    expect(canReverseJournalEntry("posted", true)).toBe(false);
  });

  it("refuses a non-posted entry (draft / reversed status)", () => {
    expect(canReverseJournalEntry("draft", false)).toBe(false);
    expect(canReverseJournalEntry("reversed", false)).toBe(false);
  });

  it("never reverses on an unknown status", () => {
    expect(canReverseJournalEntry("weird", false)).toBe(false);
  });
});
