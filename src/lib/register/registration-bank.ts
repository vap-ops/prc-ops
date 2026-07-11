// Spec 296 — client-side UX pre-check for the applicant's declared bank fields.
// AUTHORITATIVE gate is the DB RPC record_own_staff_bank; this only gives the
// applicant immediate feedback and drives the approval-floor checklist's
// `hasBankFields`. Keep the rules in lockstep with the RPC: all three non-empty;
// the account number, after stripping spaces/dashes, is 6-20 digits.

const ACCOUNT_NUMBER_RE = /^[0-9]{6,20}$/;

/** Strip spaces and dashes so "123-456 789" and "123456789" are the same value. */
export function normalizeAccountNumber(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** Returns a Thai error message if the declaration is invalid, else null. */
export function validateRegistrationBank(input: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}): string | null {
  if (!input.bankName.trim()) return "กรุณาระบุธนาคาร";
  if (!input.accountName.trim()) return "กรุณาระบุชื่อบัญชี";
  if (!ACCOUNT_NUMBER_RE.test(normalizeAccountNumber(input.accountNumber))) {
    return "เลขที่บัญชีต้องเป็นตัวเลข 6-20 หลัก";
  }
  return null;
}
