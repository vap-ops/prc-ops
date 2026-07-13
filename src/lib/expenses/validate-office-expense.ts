// Spec 310 — pure validator for a non-WP office expense. Friendly Thai errors
// before the RPC; the DEFINER RPC re-checks everything server-side.

import { ISO_DATE_REGEX } from "@/lib/dates";
import type { Database } from "@/lib/db/database.types";
import { UUID_REGEX } from "@/lib/validate/uuid";

export type PaymentSource = Database["public"]["Enums"]["payment_source"];

export interface OfficeExpenseInput {
  categoryId: string;
  description: string;
  amount: number;
  expenseDate: string;
  paymentSource: PaymentSource;
  projectId: string | null;
  companyCardId: string | null;
}

export interface ValidatedOfficeExpense extends OfficeExpenseInput {
  description: string;
}

export type ValidateResult =
  | { ok: true; value: ValidatedOfficeExpense }
  | { ok: false; error: string };

export function validateOfficeExpense(input: OfficeExpenseInput): ValidateResult {
  if (!UUID_REGEX.test(input.categoryId)) {
    return { ok: false, error: "กรุณาเลือกประเภทค่าใช้จ่าย" };
  }
  // Spec 310 U10 — รายละเอียด is optional now (operator 2026-07-13). Empty is fine.
  const description = input.description.trim();
  if (description.length > 500) return { ok: false, error: "รายละเอียดต้องไม่เกิน 500 ตัวอักษร" };

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "จำนวนเงินต้องมากกว่า 0" };
  }
  if (!ISO_DATE_REGEX.test(input.expenseDate)) {
    return { ok: false, error: "กรุณาระบุวันที่" };
  }
  if (input.projectId !== null && !UUID_REGEX.test(input.projectId)) {
    return { ok: false, error: "โครงการไม่ถูกต้อง" };
  }

  if (input.paymentSource === "company_card") {
    if (!input.companyCardId || !UUID_REGEX.test(input.companyCardId)) {
      return { ok: false, error: "กรุณาเลือกบัตร" };
    }
  } else if (input.companyCardId !== null) {
    return { ok: false, error: "แหล่งจ่ายนี้ไม่ต้องระบุบัตร" };
  }

  return { ok: true, value: { ...input, description } };
}
