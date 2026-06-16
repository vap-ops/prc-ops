// Spec 130 U4 — pure validation for the DC bank-change request (contractor
// portal). Thai, contractor-facing. Length caps mirror the contact_bank /
// contractor_bank_change_requests CHECKs; the submit RPC re-guards role/own/dup.

export function validateBankChange(input: {
  bankName: string;
  accountNo: string;
  accountName: string;
}): string | null {
  const name = input.bankName.trim();
  const no = input.accountNo.trim();
  const acct = input.accountName.trim();

  if (!name) return "กรุณาระบุชื่อธนาคาร";
  if (name.length > 200) return "ชื่อธนาคารยาวเกินไป";
  if (!no) return "กรุณาระบุเลขที่บัญชี";
  if (no.length > 50) return "เลขที่บัญชียาวเกินไป";
  if (!/\d/.test(no)) return "เลขที่บัญชีไม่ถูกต้อง";
  if (!acct) return "กรุณาระบุชื่อบัญชี";
  if (acct.length > 200) return "ชื่อบัญชียาวเกินไป";
  return null;
}
