"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import {
  validateOfficeExpense,
  type OfficeExpenseInput,
} from "@/lib/expenses/validate-office-expense";

export type RecordExpenseResult = { ok: true; id: string } | { ok: false; error: string };

// Record a non-WP office expense. The reimburse-target is resolved inside the
// DEFINER RPC from the payment source — never trusted from the client.
export async function recordOfficeExpense(input: OfficeExpenseInput): Promise<RecordExpenseResult> {
  const validated = validateOfficeExpense(input);
  if (!validated.ok) return validated;

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const v = validated.value;
  const { data, error } = await auth.supabase.rpc("record_office_expense", {
    p_category_id: v.categoryId,
    p_description: v.description,
    p_amount: v.amount,
    p_expense_date: v.expenseDate,
    p_payment_source: v.paymentSource,
    ...(v.projectId ? { p_project_id: v.projectId } : {}),
    ...(v.companyCardId ? { p_company_card_id: v.companyCardId } : {}),
  });
  if (error || !data) return { ok: false, error: "บันทึกค่าใช้จ่ายไม่สำเร็จ กรุณาลองใหม่" };

  revalidatePath("/expenses");
  return { ok: true, id: data };
}
