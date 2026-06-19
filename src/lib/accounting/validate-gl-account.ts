// Spec 149 U1 / ADR 0057 — pure validation for a gl_accounts row (the chart of
// accounts). The UI gate before upsert_gl_account; the RPC + DB CHECKs
// (normal_side ∈ {debit,credit}, code ≤ 20, name ≤ 120, account_type enum)
// re-guard. No tree validation — parent existence is a DB concern (the RPC
// resolves p_parent_code and raises P0001 on an unknown parent).

export const GL_ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type GlAccountType = (typeof GL_ACCOUNT_TYPES)[number];

export const GL_NORMAL_SIDES = ["debit", "credit"] as const;
export type GlNormalSide = (typeof GL_NORMAL_SIDES)[number];

const CODE_MAX = 20;
const NAME_MAX = 120;

export interface GlAccountInput {
  code: string;
  nameTh: string;
  normalSide: string;
  accountType: string;
}

export type ValidateGlAccountResult = { ok: true } | { ok: false; error: string };

export function validateGlAccount(input: GlAccountInput): ValidateGlAccountResult {
  const code = input.code.trim();
  if (code.length === 0) {
    return { ok: false, error: "กรุณาระบุรหัสบัญชี" };
  }
  if (code.length > CODE_MAX) {
    return { ok: false, error: `รหัสบัญชีต้องไม่เกิน ${CODE_MAX} ตัวอักษร` };
  }

  const nameTh = input.nameTh.trim();
  if (nameTh.length === 0) {
    return { ok: false, error: "กรุณาระบุชื่อบัญชี" };
  }
  if (nameTh.length > NAME_MAX) {
    return { ok: false, error: `ชื่อบัญชีต้องไม่เกิน ${NAME_MAX} ตัวอักษร` };
  }

  if (!(GL_NORMAL_SIDES as readonly string[]).includes(input.normalSide)) {
    return { ok: false, error: "ด้านปกติไม่ถูกต้อง" };
  }

  if (!(GL_ACCOUNT_TYPES as readonly string[]).includes(input.accountType)) {
    return { ok: false, error: "ประเภทบัญชีไม่ถูกต้อง" };
  }

  return { ok: true };
}
