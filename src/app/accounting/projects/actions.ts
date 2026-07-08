"use server";

// Spec 253 — drill write actions over the spec 250/249 DEFINER RPCs. Same
// posture as the billings actions: requireActionRole(BILLING_WRITE_ROLES)
// mirrors the RPCs' is_manager() gate (accounting reads the drill but holds
// zero write affordances; the RPC refuses it regardless).

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import {
  BILLING_WRITE_ROLES,
  ACCOUNTING_ACTION_ERROR as GENERIC,
} from "@/lib/accounting/billing-actions";
import type { AccountingActionResult } from "@/lib/accounting/billing-actions";
import type { Database } from "@/lib/db/database.types";

type ReceiptMethod = Database["public"]["Enums"]["receipt_method"];

function drillPath(projectId: string): string {
  return `/accounting/projects/${projectId}`;
}

export async function createQuotation(input: {
  projectId: string;
  quotationNo: string;
  amount: number;
  quoteDate: string;
  note?: string | null;
}): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!input.quotationNo.trim() || !(input.amount > 0) || !input.quoteDate) {
    return { ok: false, error: GENERIC };
  }
  const args: {
    p_project_id: string;
    p_quotation_no: string;
    p_amount: number;
    p_quote_date: string;
    p_note?: string;
  } = {
    p_project_id: input.projectId,
    p_quotation_no: input.quotationNo.trim(),
    p_amount: input.amount,
    p_quote_date: input.quoteDate,
  };
  if (input.note) args.p_note = input.note;
  const { error } = await g.auth.supabase.rpc("create_quotation", args);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(drillPath(input.projectId));
  return { ok: true };
}

export async function createClientPo(input: {
  projectId: string;
  poNo: string;
  amount: number;
  poDate: string;
  quotationId?: string | null;
  note?: string | null;
}): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!input.poNo.trim() || !(input.amount > 0) || !input.poDate) {
    return { ok: false, error: GENERIC };
  }
  const args: {
    p_project_id: string;
    p_po_no: string;
    p_amount: number;
    p_po_date: string;
    p_quotation_id?: string;
    p_note?: string;
  } = {
    p_project_id: input.projectId,
    p_po_no: input.poNo.trim(),
    p_amount: input.amount,
    p_po_date: input.poDate,
  };
  if (input.quotationId) args.p_quotation_id = input.quotationId;
  if (input.note) args.p_note = input.note;
  const { error } = await g.auth.supabase.rpc("create_client_po", args);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(drillPath(input.projectId));
  return { ok: true };
}

export async function upsertContract(input: {
  projectId: string;
  contractValue: number;
  retentionRate: number;
  contractNo?: string | null;
  quotationId?: string | null;
  clientPoId?: string | null;
  signDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
}): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!(input.contractValue > 0) || input.retentionRate < 0 || input.retentionRate > 100) {
    return { ok: false, error: GENERIC };
  }
  const args: {
    p_project_id: string;
    p_contract_value: number;
    p_retention_rate: number;
    p_quotation_id?: string;
    p_client_po_id?: string;
    p_contract_no?: string;
    p_sign_date?: string;
    p_start_date?: string;
    p_end_date?: string;
    p_note?: string;
  } = {
    p_project_id: input.projectId,
    p_contract_value: input.contractValue,
    p_retention_rate: input.retentionRate,
  };
  if (input.quotationId) args.p_quotation_id = input.quotationId;
  if (input.clientPoId) args.p_client_po_id = input.clientPoId;
  if (input.contractNo) args.p_contract_no = input.contractNo;
  if (input.signDate) args.p_sign_date = input.signDate;
  if (input.startDate) args.p_start_date = input.startDate;
  if (input.endDate) args.p_end_date = input.endDate;
  if (input.note) args.p_note = input.note;
  const { error } = await g.auth.supabase.rpc("upsert_project_contract", args);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(drillPath(input.projectId));
  return { ok: true };
}

export async function addInstallment(input: {
  projectId: string;
  contractId: string;
  seq: number;
  label: string;
  amount: number;
  plannedDate?: string | null;
}): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (
    !Number.isInteger(input.seq) ||
    input.seq <= 0 ||
    !input.label.trim() ||
    !(input.amount > 0)
  ) {
    return { ok: false, error: GENERIC };
  }
  const args: {
    p_contract_id: string;
    p_seq: number;
    p_label: string;
    p_amount: number;
    p_planned_date?: string;
  } = {
    p_contract_id: input.contractId,
    p_seq: input.seq,
    p_label: input.label.trim(),
    p_amount: input.amount,
  };
  if (input.plannedDate) args.p_planned_date = input.plannedDate;
  const { error } = await g.auth.supabase.rpc("add_contract_installment", args);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(drillPath(input.projectId));
  return { ok: true };
}

// Advance receipt — money before billing/contract (the recurring real case).
export async function recordAdvanceReceipt(input: {
  projectId: string;
  amount: number;
  receivedDate: string;
  method: string;
  note?: string | null;
}): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  if (!(input.amount > 0) || !input.receivedDate) return { ok: false, error: GENERIC };
  const args: {
    p_project_id: string;
    p_amount: number;
    p_received_date: string;
    p_method: ReceiptMethod;
    p_note?: string;
  } = {
    p_project_id: input.projectId,
    p_amount: input.amount,
    p_received_date: input.receivedDate,
    p_method: input.method as ReceiptMethod,
  };
  if (input.note) args.p_note = input.note;
  const { error } = await g.auth.supabase.rpc("record_client_receipt", args);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath(drillPath(input.projectId));
  return { ok: true };
}
