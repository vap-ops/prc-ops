// Spec 395 U1 — is a worker's wage landing in that worker's OWN account?
//
// Why this exists (measured 2026-08-04): three different technicians are paid into
// one account whose holder is a MINOR (`ด.ช.`), and spec 320 already built the
// consented way to record exactly that — `worker_payout_nominee`, four DEFINER RPCs,
// a required consent document, and a 45-day reclaim nudge — which has **0 rows all
// time**. The mechanism is not missing; the third-party accounts simply never reach
// it, because bank fields live on the `/workers` edit sheet while the nominee control
// lives under `/settings/payout-nominees`. This module is the detector that makes the
// gap countable so U2/U3 can close it.
//
// ⚠️ A non-matching holder is NORMAL at this firm — the operator's own correction:
// "some technicians use family's account temporarily". `unrecorded` means NOT WRITTEN
// DOWN YET, never "wrong". Any copy built on this must read as an invitation.
//
// Pure and synchronous on purpose: the bank columns are zero-grant PII, so the only
// caller that can supply this input is the admin seam (see `payout-account-audit.ts`).

import { normaliseThaiPersonName } from "@/lib/workers/thai-name";

export type PayoutAccountState = "own" | "nominee" | "unrecorded";

export interface PayoutAccountWorker {
  workerId: string;
  name: string;
  accountNumber: string | null;
  accountName: string | null;
}

export interface PayoutAccountAssessment {
  workerId: string;
  state: PayoutAccountState;
  /**
   * Distinct workers paid into this account, **including this one** — so `1` means
   * not shared, and the concentration case reports **3**.
   *
   * ⚠️ Deliberately the GROUP size rather than a count of "others": spec §3 headlines
   * the number 3 for that account, and a per-worker "2 others" would quietly disagree
   * with the figure in the spec and in every conversation about it.
   */
  accountWorkerCount: number;
  nameMatches: boolean;
}

/** Same-account grouping key. Trimmed only — see the fuzzy-matching warning below. */
function accountKey(accountNumber: string): string {
  return accountNumber.trim();
}

/**
 * Assess every worker who HAS a payout account.
 *
 * `workers` must already be filtered to the **active** roster.
 * ⚠️ That filter is load-bearing, and spec 396's incident is the proof: account
 * `020203221364` carries a second row, `นายเหิน เมืองงาม` — the deactivated remains
 * of a back-office mis-edit that overwrote a real employee's record. Counting
 * inactive rows would report that account as shared forever, flagging a correct
 * record over a mistake that has already been reversed. Active-only takes the live
 * shared-account count from 4 to 3.
 *
 * Workers with no account number are OMITTED rather than given a state: "has no bank
 * account yet" is a different worklist and spec 320's `listBanklessWorkers` already
 * owns it. Returning them here would inflate `unrecorded` with people who have
 * nothing to record.
 */
export function assessPayoutAccounts(
  workers: readonly PayoutAccountWorker[],
  nomineeWorkerIds: ReadonlySet<string>,
): PayoutAccountAssessment[] {
  const banked = workers.filter((w) => (w.accountNumber ?? "").trim() !== "");

  // ⚠️ Exact (trimmed) grouping, never fuzzy. `044162319729` and `014162319729` differ
  // by one character and are almost certainly a typo for each other — but inventing a
  // shared account that does not exist would put two workers in a group the bank
  // knows nothing about. Spec §5 leaves that judgement to U4, as a human correction.
  const countByAccount = new Map<string, number>();
  for (const w of banked) {
    const key = accountKey(w.accountNumber as string);
    countByAccount.set(key, (countByAccount.get(key) ?? 0) + 1);
  }

  return banked.map((w) => {
    const accountWorkerCount = countByAccount.get(accountKey(w.accountNumber as string)) ?? 1;

    // ⚠️ An empty normalisation is an ABSENCE of evidence, not a match — the same rule
    // `isNormalisingRename` enforces. A blank holder name, or a worker name that is a
    // bare honorific, must never read as "this is their own account".
    const person = normaliseThaiPersonName(w.name);
    const holder = normaliseThaiPersonName(w.accountName ?? "");
    const nameMatches = person !== "" && holder !== "" && person === holder;

    const state: PayoutAccountState = nomineeWorkerIds.has(w.workerId)
      ? "nominee"
      : accountWorkerCount === 1 && nameMatches
        ? "own"
        : "unrecorded";

    return { workerId: w.workerId, state, accountWorkerCount, nameMatches };
  });
}
