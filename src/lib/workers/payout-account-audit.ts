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

  // ⚠️ OWED, and deliberately not fixed from here: `listActivePayoutNominees` discards
  // its own `error` and returns [] (spec 320's module, two shipped pages depend on that
  // shape). A REJECTED call propagates through the Promise.all above and is pinned by
  // test; a returned PostgREST error would instead read as "no nominees", marking every
  // consented worker `unrecorded`. Harmless while the table has 0 rows — becomes wrong
  // the day U3 writes the first one, so fix it there rather than widening this unit.

  const workers = (data ?? []).map((r) => ({
    workerId: r.id,
    name: r.name,
    accountNumber: r.bank_account_number,
    accountName: r.bank_account_name,
  }));

  // ⚠️ A nominee record consents to ONE account, and payroll pays whatever currently
  // sits in `workers.bank_account_number`. So EXISTENCE of a nominee row is not the
  // question — coverage of the account on file is. A nominee recorded for account X
  // while the worker row has since moved to a different third-party account Y
  // describes an arrangement nobody is being paid under, and counting it would
  // silence this flag permanently: the exact failure the detector exists to prevent.
  // ⚠️ Both sides are separator-stripped, and asymmetry here would be invisible and
  // permanent: `set_worker_payout_nominee` stores the payee number through
  // `regexp_replace(…, '[\s-]', '', 'g')`, while `workers.bank_account_number` is stored
  // as typed. Comparing a normalised value against a raw one would leave a worker whose
  // bank number carries dashes badged FOREVER, with the record already made and no way
  // to tell why the badge will not clear. (All 42 live numbers are digits-only today, so
  // this costs nothing now and removes a trap later.)
  const digits = (s: string | null | undefined) => (s ?? "").replace(/[\s-]/gu, "");
  const accountByWorker = new Map(workers.map((w) => [w.workerId, digits(w.accountNumber)]));
  const covered = new Set(
    nominees
      .filter((n) => digits(n.accountNumber) === accountByWorker.get(n.workerId))
      .map((n) => n.workerId),
  );

  return assessPayoutAccounts(workers, covered);
}
