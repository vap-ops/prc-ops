// Spec 149 U9 — /accounting dashboard loader. Calls the two read-only GL RPCs on
// the AUTHENTICATED session (gl_trial_balance + gl_reconciliation are SECURITY
// DEFINER, gated pm/super/accounting) and shapes the trial-balance rows to the
// camelCase view contract (src/lib/accounting/trial-balance-view.ts). The two
// reads are independent → one Promise.all.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { TrialBalanceRow } from "@/lib/accounting/trial-balance-view";

type Fns = Database["public"]["Functions"];
export type ReconciliationRow = Fns["gl_reconciliation"]["Returns"][number];

export interface TrialBalanceLine extends TrialBalanceRow {
  code: string;
  nameTh: string;
  balance: number;
}

export interface AccountingDashboard {
  trialBalance: TrialBalanceLine[];
  reconciliation: ReconciliationRow[];
}

export async function loadAccountingDashboard(
  supabase: SupabaseClient<Database>,
  from: string,
  to: string,
): Promise<AccountingDashboard> {
  const [tb, recon] = await Promise.all([
    supabase.rpc("gl_trial_balance", { p_from: from, p_to: to }),
    supabase.rpc("gl_reconciliation"),
  ]);
  if (tb.error) throw new Error(`gl_trial_balance: ${tb.error.message}`);
  if (recon.error) throw new Error(`gl_reconciliation: ${recon.error.message}`);

  const trialBalance: TrialBalanceLine[] = (tb.data ?? []).map((r) => ({
    code: r.code,
    nameTh: r.name_th,
    accountType: r.account_type,
    debitTotal: Number(r.debit_total),
    creditTotal: Number(r.credit_total),
    balance: Number(r.balance),
  }));

  return { trialBalance, reconciliation: recon.data ?? [] };
}
