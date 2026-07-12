"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { buildExpenseAttachmentPath } from "@/lib/expenses/attachment-path";
import {
  validateOfficeExpense,
  type OfficeExpenseInput,
} from "@/lib/expenses/validate-office-expense";
import { isValidAttachmentExt } from "@/lib/purchasing/attachment-file";
import { UUID_REGEX } from "@/lib/validate/uuid";

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

const ERR_RECEIPT = "แนบใบเสร็จไม่สำเร็จ กรุณาลองใหม่";

export interface AddExpenseReceiptInput {
  officeExpenseId: string;
  attachmentId: string;
  ext: string;
}
export type ReceiptResult = { ok: true } | { ok: false; error: string };

// Record a receipt attachment for an office expense. The bytes were already
// uploaded to the expense-attachments bucket by the client; this only writes the
// metadata row (server rebuilds the path). Authorization = the row is visible to
// the caller under RLS (submitter or finance). Idempotent on replay (23505).
export async function addExpenseReceipt(input: AddExpenseReceiptInput): Promise<ReceiptResult> {
  if (!UUID_REGEX.test(input.officeExpenseId) || !UUID_REGEX.test(input.attachmentId)) {
    return { ok: false, error: ERR_RECEIPT };
  }
  if (!isValidAttachmentExt(input.ext)) return { ok: false, error: ERR_RECEIPT };

  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { supabase, user } = auth;

  const storagePath = buildExpenseAttachmentPath(
    input.officeExpenseId,
    input.attachmentId,
    input.ext,
  );
  if (!storagePath) return { ok: false, error: ERR_RECEIPT };

  // Authorization: the caller must be able to see the parent expense (RLS =
  // submitter or finance). If not visible, refuse.
  const { data: parent } = await supabase
    .from("office_expenses")
    .select("id")
    .eq("id", input.officeExpenseId)
    .maybeSingle();
  if (!parent) return { ok: false, error: ERR_RECEIPT };

  const { error } = await supabase.from("office_expense_attachments").insert({
    id: input.attachmentId,
    office_expense_id: input.officeExpenseId,
    storage_path: storagePath,
    created_by: user.id,
  });
  if (error && error.code !== "23505") return { ok: false, error: ERR_RECEIPT };

  revalidatePath("/expenses");
  return { ok: true };
}

export type MarkReimbursedResult = { ok: true } | { ok: false; error: string };

// Mark an expense reimbursed (finance only — the DEFINER RPC gates + is
// concurrent-safe). Idempotent guard lives in the RPC.
export async function markExpenseReimbursed(id: string): Promise<MarkReimbursedResult> {
  if (!UUID_REGEX.test(id)) return { ok: false, error: "ทำเครื่องหมายคืนเงินไม่สำเร็จ" };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("mark_expense_reimbursed", { p_expense_id: id });
  if (error) {
    // The realistic failure is a race / double-click on an already-settled row —
    // surface that specific case in Thai (the raw RPC message is English).
    if (error.message?.includes("already reimbursed")) {
      return { ok: false, error: "รายการนี้ถูกทำเครื่องหมายคืนเงินแล้ว" };
    }
    return { ok: false, error: "ทำเครื่องหมายคืนเงินไม่สำเร็จ" };
  }
  revalidatePath("/expenses");
  return { ok: true };
}
