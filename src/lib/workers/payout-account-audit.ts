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
import { listActivePayoutNominees, listBanklessWorkers } from "@/lib/payroll/payout-nominee";
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

/** Why this worker is worth offering a nominee record for. */
export type NomineeCandidateReason = "no-account" | "not-own-account";

export interface NomineeCandidate {
  id: string;
  name: string;
  code: string | null;
  reason: NomineeCandidateReason;
}

/**
 * The population the nominee picker may offer.
 *
 * ⚠️ THE BUG THIS CLOSES: the picker listed ONLY bankless workers ("เลือกช่างที่ยังไม่มี
 * บัญชีธนาคารของตัวเอง"), and every worker spec 395 is about HAS an account — it simply is
 * not theirs. So none of the 8 live cases was selectable through the normal flow at all;
 * U2's badge could reach them only by deep-linking `?worker=`, which works but is not a
 * route a human discovers.
 *
 * Two reasons a nominee makes sense, unioned:
 *   `no-account`      — spec 320's original case: nothing of their own to pay into.
 *   `not-own-account` — spec 395's case: an account that belongs to someone else.
 *
 * ⚠️ Contractor-tied workers are excluded from BOTH arms (spec 328 U3): a pay-exempt
 * subcon member is permanently bankless BY DESIGN — the firm pays the subcontractor, so
 * routing a nominee payout for one would move money PRC never owes. Measured 2026-08-05,
 * all 8 live `unrecorded` workers are firm-paid, so this excludes none of them today;
 * the rule is what matters, not the count.
 *
 * Takes the assessments as an argument rather than re-reading them: the caller usually
 * has them already, and it keeps this function pure enough to test without a live DB.
 */
export async function listNomineeCandidates(
  supabase: ServerClient,
  assessments: ReadonlyArray<PayoutAccountAssessment>,
): Promise<NomineeCandidate[]> {
  const notOwnIds = assessments.filter((a) => a.state === "unrecorded").map((a) => a.workerId);

  const [bankless, notOwnRows] = await Promise.all([
    listBanklessWorkers(),
    (async () => {
      // No ids ⇒ no query. A bare `.in("id", [])` is a pointless round trip.
      if (notOwnIds.length === 0) return [];
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("workers")
        .select("id, name, employee_id, contractor_id")
        .in("id", notOwnIds);
      if (error) throw new Error(`nominee candidates: ${error.message}`);
      return data ?? [];
    })(),
  ]);

  const candidates: NomineeCandidate[] = [
    ...bankless.map((w) => ({ ...w, reason: "no-account" as const })),
    ...notOwnRows
      .filter((r) => r.contractor_id === null)
      .map((r) => ({
        id: r.id,
        name: r.name,
        code: r.employee_id,
        reason: "not-own-account" as const,
      })),
  ];

  // One list sorted by name, NOT two blocks: the picker is a "find this person" surface,
  // and grouping by reason would make a worker's position depend on a classification the
  // reader is not thinking about.
  return candidates.sort((a, b) => a.name.localeCompare(b.name, "th"));
}
