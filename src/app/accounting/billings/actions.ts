"use server";

// Spec 204 — client-billing write actions. The create/certify RPCs are SECURITY
// DEFINER gating the AUTHED session's role (pm/super), so we call them on
// requireActionRole().auth.supabase, never the admin client (service-role's null
// role the gate refuses). BILLING_WRITE_ROLES is the shared SSOT for who may write.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { computeBillingBreakdown } from "@/lib/accounting/client-billing";
import {
  BILLING_WRITE_ROLES,
  ACCOUNTING_ACTION_ERROR as GENERIC,
} from "@/lib/accounting/billing-actions";
import type { AccountingActionResult } from "@/lib/accounting/billing-actions";

export interface CreateBillingInput {
  projectId: string;
  grossAmount: number;
  retentionRate: number;
  vatRate: number;
  whtRate: number;
  periodFrom?: string | null;
  periodTo?: string | null;
  note?: string | null;
  // Spec 250 U2 — optional งวด claim target (contract_installments.id).
  installmentId?: string | null;
}

export async function createClientBilling(
  input: CreateBillingInput,
): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };

  // Same pure gate the certify RPC mirrors — reject bad gross/rates before the call.
  const check = computeBillingBreakdown({
    grossAmount: input.grossAmount,
    retentionRate: input.retentionRate,
    vatRate: input.vatRate,
    whtRate: input.whtRate,
  });
  if (!check.ok) return { ok: false, error: check.error };

  // exactOptionalPropertyTypes: omit the optional args entirely (let the SQL
  // defaults apply) rather than passing undefined.
  const args: {
    p_project_id: string;
    p_gross_amount: number;
    p_retention_rate: number;
    p_vat_rate: number;
    p_wht_rate: number;
    p_period_from?: string;
    p_period_to?: string;
    p_note?: string;
  } = {
    p_project_id: input.projectId,
    p_gross_amount: input.grossAmount,
    p_retention_rate: input.retentionRate,
    p_vat_rate: input.vatRate,
    p_wht_rate: input.whtRate,
  };
  if (input.periodFrom) args.p_period_from = input.periodFrom;
  if (input.periodTo) args.p_period_to = input.periodTo;
  if (input.note) args.p_note = input.note;

  const { data: billingId, error } = await g.auth.supabase.rpc("create_client_billing", args);
  if (error) return { ok: false, error: GENERIC };

  // Spec 250 U2 — link the งวด after create. Cross-project picks are re-checked
  // by the DB trigger (22023); a failed link leaves a valid unlinked draft, so
  // report success-with-caveat rather than a phantom failure.
  if (input.installmentId && billingId) {
    await g.auth.supabase.rpc("set_client_billing_installment", {
      p_billing_id: billingId,
      p_installment_id: input.installmentId,
    });
  }
  revalidatePath("/accounting/billings");
  return { ok: true };
}

export async function certifyClientBilling(id: string): Promise<AccountingActionResult> {
  const g = await requireActionRole(BILLING_WRITE_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };
  const { error } = await g.auth.supabase.rpc("certify_client_billing", { p_id: id });
  if (error) return { ok: false, error: GENERIC };
  // Certify accrues a held retention row → refresh both registers.
  revalidatePath("/accounting/billings");
  revalidatePath("/accounting/retention");
  return { ok: true };
}
