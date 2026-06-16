// Spec 127 U2 — server reads backing the payroll payment surface. dc_payments
// and contact_bank both have zero authenticated grant (money), so reads go
// through the service-role admin client; callers MUST be behind
// requireRole(PM_ROLES). Payments are matched to the viewed period by exact
// (period_from, period_to) — the same key annotatePayrollPayments uses.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { ContactBank } from "@/lib/contacts/bank";
import type { PayrollRange } from "./payroll";
import type { DcPaymentRow } from "./payments";

export async function fetchPeriodPayments(
  admin: SupabaseClient<Database>,
  range: PayrollRange,
): Promise<DcPaymentRow[]> {
  const { data, error } = await admin
    .from("dc_payments")
    .select(
      "id, contractor_id, period_from, period_to, computed_amount, paid_amount, paid_at, method, superseded_by",
    )
    .eq("period_from", range.from)
    .eq("period_to", range.to);
  if (error) throw new Error(`fetch dc_payments: ${error.message}`);
  return data ?? [];
}

export async function fetchContractorBanks(
  admin: SupabaseClient<Database>,
  contractorIds: ReadonlyArray<string>,
): Promise<Map<string, ContactBank>> {
  const map = new Map<string, ContactBank>();
  if (contractorIds.length === 0) return map;
  const { data, error } = await admin
    .from("contact_bank")
    .select("contractor_id, bank_name, bank_account_no, bank_account_name")
    .in("contractor_id", contractorIds as string[]);
  if (error) throw new Error(`fetch contact_bank: ${error.message}`);
  for (const r of data ?? []) {
    if (!r.contractor_id) continue;
    map.set(r.contractor_id, {
      bankName: r.bank_name ?? "",
      bankAccountNo: r.bank_account_no ?? "",
      bankAccountName: r.bank_account_name ?? "",
    });
  }
  return map;
}
