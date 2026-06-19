// Spec 149 U3 / ADR 0057 decision 3 — pure validation for a journal entry's
// lines: double-entry must balance (Σdebit = Σcredit), every line is one-sided
// and non-negative, at least two lines, a non-empty account code. The UI gate
// before post_journal_entry; the post_journal_internal RPC re-guards (balance +
// is_postable per line + the period P0002 guard). Amounts compared in integer
// cents (Math.round(x * 100)) so float drift (0.1 + 0.2) never unbalances a real
// entry. Account existence / postability is a DB concern, not validated here.

export interface JournalLineInput {
  accountCode: string;
  debit: number;
  credit: number;
}

export type ValidateJournalLinesResult = { ok: true } | { ok: false; error: string };

function cents(n: number): number {
  return Math.round(n * 100);
}

export function validateJournalLines(lines: JournalLineInput[]): ValidateJournalLinesResult {
  if (lines.length < 2) {
    return { ok: false, error: "รายการบัญชีต้องมีอย่างน้อย 2 บรรทัด" };
  }

  let debitCents = 0;
  let creditCents = 0;

  for (const ln of lines) {
    if (ln.accountCode.trim().length === 0) {
      return { ok: false, error: "กรุณาระบุรหัสบัญชีทุกบรรทัด" };
    }
    if (!Number.isFinite(ln.debit) || !Number.isFinite(ln.credit)) {
      return { ok: false, error: "จำนวนเงินไม่ถูกต้อง" };
    }
    if (ln.debit < 0 || ln.credit < 0) {
      return { ok: false, error: "จำนวนเงินต้องไม่ติดลบ" };
    }
    const d = cents(ln.debit);
    const c = cents(ln.credit);
    // Exactly one side per line (XOR): one positive, the other zero.
    if (d > 0 === c > 0) {
      return {
        ok: false,
        error: "แต่ละบรรทัดต้องเป็นเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง",
      };
    }
    debitCents += d;
    creditCents += c;
  }

  if (debitCents !== creditCents) {
    return { ok: false, error: "ยอดเดบิตและเครดิตต้องเท่ากัน" };
  }

  return { ok: true };
}
