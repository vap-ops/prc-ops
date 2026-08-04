import "server-only";

// Spec 395 U1 — the admin seam that feeds the payout-account detector.
//
// Why the admin client rather than the caller's RLS session (verified live 2026-08-04):
//   has_column_privilege('authenticated','public.workers','bank_account_number','SELECT') = FALSE
//   has_column_privilege('authenticated','public.workers','bank_account_name','SELECT')   = FALSE
// The bank columns are zero-grant PII (ADR 0079), and the shared-account count is
// inherently cross-worker, so the question is not expressible under row-level scoping
// at all. Same seam discipline as `payout-nominee.ts` and spec 306's badge codes: the
// admin read is narrow, column-listed, and sits behind an already-authorized page gate.
//
// The nominee half deliberately does NOT come through this client — it comes from the
// DEFINER RPC via the caller's session, so the existing gate stays the one authority
// on who may see nominee rows.

import { createClient as createAdminClient } from "@/lib/db/admin";
import { listActivePayoutNominees } from "@/lib/payroll/payout-nominee";
import { assessPayoutAccounts, type PayoutAccountAssessment } from "@/lib/workers/payout-account";

type ServerClient = Awaited<ReturnType<typeof import("@/lib/db/server").createClient>>;

export async function loadPayoutAccountAudit(
  supabase: ServerClient,
): Promise<PayoutAccountAssessment[]> {
  const admin = createAdminClient();

  const [{ data, error }, nominees] = await Promise.all([
    admin
      .from("workers")
      .select("id, name, bank_account_number, bank_account_name")
      // ⚠️ Active-only, and spec 396's incident is why: account 020203221364 carries a
      // second row — `นายเหิน เมืองงาม`, the deactivated remains of a back-office
      // mis-edit that overwrote a real employee's record. Counting inactive rows would
      // report that account as shared forever, flagging a record that is already
      // correct. This filter takes the live shared-account count from 4 to 3.
      .eq("active", true),
    listActivePayoutNominees(supabase),
  ]);

  // ⚠️ Never degrade to [] here. This reader exists to make a gap COUNTABLE, so an
  // empty result is read as "nothing left to record" — the one lie that would quietly
  // undo the feature. Fail loudly instead.
  if (error) {
    throw new Error(`payout account audit read failed: ${error.message}`);
  }

  const workers = (data ?? []).map((r) => ({
    workerId: r.id,
    name: r.name,
    accountNumber: r.bank_account_number,
    accountName: r.bank_account_name,
  }));

  return assessPayoutAccounts(workers, new Set(nominees.map((n) => n.workerId)));
}
