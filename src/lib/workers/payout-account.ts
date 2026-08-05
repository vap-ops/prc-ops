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
   * with the figure in the spec and in every conversation about it. ⚠️ Spec §5 sketches
   * this field as `sharedWithCount`, which reads as "others" — the name here is
   * different ON PURPOSE so the two readings cannot be confused. Use `isShared` for
   * the yes/no; never render `accountWorkerCount` as "shared with N people".
   */
  accountWorkerCount: number;
  /** `accountWorkerCount > 1`, precomputed so badge copy never re-derives it wrongly. */
  isShared: boolean;
  nameMatches: boolean;
  /**
   * Spec 395 U4 — the OTHER active workers paid into this same account, by name,
   * **excluding the subject**.
   *
   * ⚠️ This is the fact that tells §5's three outcomes apart, and the app showed it
   * nowhere: several other technicians on one account reads "third party, record a
   * บัญชีตัวแทน"; an empty list on a flagged row reads "the name or the number is off"
   * — the `044…`/`014…` near-miss being the likely example. Without it a reviewer
   * cannot choose between recording a nominee and fixing a typo.
   *
   * Names, never ids: the reader needs to recognise people.
   */
  sharedWith: readonly string[];
}

/** Same-account grouping key. Trimmed only — see the fuzzy-matching warning below. */
function accountKey(accountNumber: string): string {
  return accountNumber.trim();
}

/**
 * Assess every worker who HAS a payout account.
 *
 * `workers` must already be filtered to the **active** roster, and
 * `nomineeCoveredWorkerIds` must contain only workers whose active nominee record
 * covers the account they are ACTUALLY paid into today (see `payout-account-audit.ts`
 * — mere existence of a nominee row is not enough).
 *
 * ⚠️ The active filter is load-bearing, and spec 396's incident is why: account
 * `020203221364` carries a second row, `นายเหิน เมืองงาม` — the deactivated remains of
 * a back-office mis-edit that overwrote a real employee's record. That row is **not
 * repaired**; it still carries the original employee's phone and employee id, and
 * restoring it needs her own answers. Scoping to the active roster keeps an unrepaired
 * artefact from reading as a live shared account (it takes the count from 4 to 3) and
 * leaves the repair itself to spec 396, where it belongs.
 *
 * ⚠️ KNOWN BLIND SPOT, stated rather than hidden: payroll's payee read
 * (`fetchWorkerBanks`) is NOT active-filtered, so a deactivated worker with unsettled
 * wages can still be paid into a shared account and this detector will not see them.
 * Spec §8 Q5 is open on exactly that; U1 scopes to the active roster deliberately.
 *
 * Workers with no account number are OMITTED rather than given a state: "has no bank
 * account yet" is a different worklist and spec 320's `listBanklessWorkers` already
 * owns it. Returning them here would inflate `unrecorded` with people who have
 * nothing to record.
 */
export function assessPayoutAccounts(
  workers: readonly PayoutAccountWorker[],
  nomineeCoveredWorkerIds: ReadonlySet<string>,
): PayoutAccountAssessment[] {
  const banked = workers
    .filter((w) => (w.accountNumber ?? "").trim() !== "")
    .map((w) => ({ worker: w, key: accountKey(w.accountNumber ?? "") }));

  // ⚠️ Exact (trimmed) grouping, never fuzzy. `044162319729` and `014162319729` differ
  // by one character and are almost certainly a typo for each other — but inventing a
  // shared account that does not exist would put two workers in a group the bank
  // knows nothing about. Spec §5 leaves that judgement to U4, as a human correction.
  //
  // ⓘ Trim only, deliberately: a FORMATTING variant of one passbook (`014-1623197-29`,
  // a non-breaking space) would split its group and hide a shared account — a false
  // negative in a detector whose zero reads as "nothing to record". Measured 2026-08-04,
  // all 42 stored numbers are digits-only, so there is nothing to normalise today.
  // Revisit with evidence rather than pre-emptively; stripping separators is formatting,
  // which is a different question from the near-miss judgement above.
  const countByAccount = new Map<string, number>();
  // Names per account, in roster order, so the sheet lists them the way the reader sees
  // them elsewhere rather than in an arbitrary Map order.
  const namesByAccount = new Map<string, { workerId: string; name: string }[]>();
  for (const b of banked) {
    countByAccount.set(b.key, (countByAccount.get(b.key) ?? 0) + 1);
    const list = namesByAccount.get(b.key) ?? [];
    list.push({ workerId: b.worker.workerId, name: b.worker.name });
    namesByAccount.set(b.key, list);
  }

  return banked.map(({ worker: w, key }) => {
    const accountWorkerCount = countByAccount.get(key) ?? 1;

    // ⚠️ An empty normalisation is an ABSENCE of evidence, not a match — the same rule
    // `isNormalisingRename` enforces. A blank holder name, or a worker name that is a
    // bare honorific, must never read as "this is their own account".
    const person = normaliseThaiPersonName(w.name);
    const holder = normaliseThaiPersonName(w.accountName ?? "");
    const nameMatches = person !== "" && holder !== "" && person === holder;

    const state: PayoutAccountState = nomineeCoveredWorkerIds.has(w.workerId)
      ? "nominee"
      : accountWorkerCount === 1 && nameMatches
        ? "own"
        : "unrecorded";

    return {
      workerId: w.workerId,
      state,
      accountWorkerCount,
      isShared: accountWorkerCount > 1,
      nameMatches,
      // ⚠️ EXCLUDES the subject. A list containing yourself reads as "you share this
      // account with yourself" and would make every group look one larger than it is.
      sharedWith: (namesByAccount.get(key) ?? [])
        .filter((o) => o.workerId !== w.workerId)
        .map((o) => o.name),
    };
  });
}
