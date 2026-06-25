"use server";

// Spec 206 — WHT certificate recording. record_wht_certificate is SECURITY DEFINER
// gating the AUTHED session's role (pm/super/project_director — verified live; the
// migration file shows pm/super but mig …0751… widened it), so we call it on
// requireActionRole().auth.supabase, never the admin client (the gate refuses
// service-role's null role). The gate reuses PM_ROLES (the role-home SSOT) rather
// than minting a new literal.

import "server-only";

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/auth/action-gate";
import { PM_ROLES } from "@/lib/auth/role-home";
import {
  validateWhtCertificate,
  type WhtDirection,
  type WhtForm,
} from "@/lib/accounting/wht-certificate";
import { ACCOUNTING_ACTION_ERROR as GENERIC } from "@/lib/accounting/billing-actions";
import type { AccountingActionResult } from "@/lib/accounting/billing-actions";

const NEEDS_PARTY = "ใบหักภาษีแบบ “เราหัก” ต้องระบุผู้ขายหรือผู้รับเหมา";

export interface RecordWhtInput {
  direction: WhtDirection;
  taxForm: WhtForm;
  incomeType: string;
  taxId: string;
  baseAmount: number;
  whtRate: number;
  supplierId?: string | null;
  contractorId?: string | null;
  clientId?: string | null;
  issuedDate?: string | null;
  note?: string | null;
}

export async function recordWhtCertificate(input: RecordWhtInput): Promise<AccountingActionResult> {
  const g = await requireActionRole(PM_ROLES, GENERIC);
  if ("error" in g) return { ok: false, error: g.error };

  // Same pure gate the RPC mirrors — reject bad direction/form/tax-id/base/rate
  // before the call.
  const check = validateWhtCertificate({
    direction: input.direction,
    taxForm: input.taxForm,
    taxId: input.taxId,
    baseAmount: input.baseAmount,
    whtRate: input.whtRate,
  });
  if (!check.ok) return { ok: false, error: check.error };

  // A deducted cert reclassifies a party payable → it needs that party. Surface a
  // specific message here rather than letting the RPC's P0001 fall to the generic.
  if (input.direction === "deducted" && !input.supplierId && !input.contractorId) {
    return { ok: false, error: NEEDS_PARTY };
  }

  // exactOptionalPropertyTypes: omit the optional args entirely (let the SQL
  // defaults apply) rather than passing undefined.
  const args: {
    p_direction: WhtDirection;
    p_tax_form: WhtForm;
    p_income_type: string;
    p_tax_id: string;
    p_base_amount: number;
    p_wht_rate: number;
    p_supplier_id?: string;
    p_contractor_id?: string;
    p_client_id?: string;
    p_issued_date?: string;
    p_note?: string;
  } = {
    p_direction: input.direction,
    p_tax_form: input.taxForm,
    p_income_type: input.incomeType,
    p_tax_id: input.taxId.trim(),
    p_base_amount: input.baseAmount,
    p_wht_rate: input.whtRate,
  };
  if (input.supplierId) args.p_supplier_id = input.supplierId;
  if (input.contractorId) args.p_contractor_id = input.contractorId;
  if (input.clientId) args.p_client_id = input.clientId;
  if (input.issuedDate) args.p_issued_date = input.issuedDate;
  if (input.note) args.p_note = input.note;

  const { error } = await g.auth.supabase.rpc("record_wht_certificate", args);
  if (error) return { ok: false, error: GENERIC };
  revalidatePath("/accounting/wht");
  return { ok: true };
}
