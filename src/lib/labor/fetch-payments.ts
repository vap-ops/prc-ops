// Spec 127 U2 / spec 170 U3 — server reads backing the payroll payment surface.
// wage_payments has zero authenticated grant (money) and the worker's bank columns
// (added in U1) have no authenticated grant either, so reads go through the
// service-role admin client; callers MUST be behind requireRole(PM_ROLES).
// Payments are matched to the viewed period by exact (period_from, period_to) —
// the same key annotatePayrollPayments uses. ADR 0062: payments and banks key on
// the worker (the payee), not a contractor party.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { ContactBank } from "@/lib/contacts/bank";
import type { PayrollRange } from "./payroll";
import type { WagePaymentRow } from "./payments";

export async function fetchPeriodPayments(
  admin: SupabaseClient<Database>,
  range: PayrollRange,
): Promise<WagePaymentRow[]> {
  const { data, error } = await admin
    .from("wage_payments")
    .select(
      "id, worker_id, period_from, period_to, computed_amount, paid_amount, paid_at, method, superseded_by",
    )
    .eq("period_from", range.from)
    .eq("period_to", range.to);
  if (error) throw new Error(`fetch wage_payments: ${error.message}`);
  return data ?? [];
}

export async function fetchWorkerBanks(
  admin: SupabaseClient<Database>,
  workerIds: ReadonlyArray<string>,
): Promise<Map<string, ContactBank>> {
  const map = new Map<string, ContactBank>();
  if (workerIds.length === 0) return map;
  const { data, error } = await admin
    .from("workers")
    .select("id, bank_name, bank_account_number, bank_account_name")
    .in("id", workerIds as string[]);
  if (error) throw new Error(`fetch worker banks: ${error.message}`);
  for (const r of data ?? []) {
    map.set(r.id, {
      bankName: r.bank_name ?? "",
      bankAccountNo: r.bank_account_number ?? "",
      bankAccountName: r.bank_account_name ?? "",
    });
  }
  return map;
}
