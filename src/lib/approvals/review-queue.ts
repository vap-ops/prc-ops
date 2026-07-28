// Spec 371 U1 — the review queue's focus split, as one pure rule.
//
// /review listed every pending_approval WP flat and the ภาพรวม badge counted the
// same set. Live on 2026-07-28 that was 70 rows of which only 52 were the PM's
// move: the other 18 were needs_revision bounces the site admin has not answered
// yet. A bounced WP stays at pending_approval by design (spec 337's cure loop
// keeps it in the queue so the decider still owns it) — but until the photos come
// back there is nothing for the PM to decide, and interleaved by queue age those
// rows were indistinguishable from real work.
//
// So the split is WHOSE MOVE IS IT. Project is degenerate (all 70 live rows are in
// one project) and trade — which IS populated, via `category_id` → project_categories
// — would still mix actionable rows with rows the PM cannot act on inside every
// group, which is the complaint itself.
//
// Pure on purpose: the page renders the zones from this, and spec 371 U2 will
// count `actionableCount` from the same predicate, so the number the PM is shown
// and the list they scroll cannot drift.

import { bangkokDateOf } from "@/lib/dates";
import type { ApprovalRevisionReason } from "@/lib/db/enums";

/** The subset of a latest-decision row this partition needs. */
export interface ReviewQueueDecision {
  id: string;
  decision: string;
  decided_at: string;
  decided_by: string;
  revision_reason: ApprovalRevisionReason | null;
}

/** The awaiting zone's row, carrying what its chase chips render from. */
export interface AwaitingSiteEntry<T> {
  row: T;
  /** approvals.decided_at — days stuck counts from the BOUNCE, not from queue entry. */
  bouncedAt: string;
  /** Spec 355's reason. Null on bounces that predate it — 7 of the 18 live rows, and
   *  they are the OLDEST, so the null path is the most-stuck rows, not a rare edge. */
  reason: ApprovalRevisionReason | null;
}

export interface ReviewQueuePartition<T> {
  /** Bounces the SA has cured — the decider can act NOW, so they lead the page. */
  readyAgain: T[];
  /** Never reviewed (and any non-bounce decision — see below). */
  firstReview: T[];
  /** Not the PM's move: waiting on the site admin to re-shoot. */
  awaitingSite: AwaitingSiteEntry<T>[];
  /** readyAgain + firstReview. The number the PM should be shown. */
  actionableCount: number;
  /** The oldest actionable row — the เริ่มตรวจงานเก่าสุด target. Null when none. */
  startHere: T | null;
  /** That row's queue-entry stamp, for the zone subtitle. Null when none. */
  oldestActionableAt: string | null;
}

export interface PartitionArgs<T extends { id: string; updated_at: string }> {
  /** Already ordered by the caller (spec 15: oldest-waiting first). Order is preserved. */
  rows: ReadonlyArray<T>;
  /** The WP's latest decision, or null if never reviewed. */
  decisionFor: (workPackageId: string) => ReviewQueueDecision | null;
  /** Whether a wp_evidence_resubmitted audit row answers that decision. */
  isAnswered: (decisionId: string) => boolean;
}

export function partitionReviewQueue<T extends { id: string; updated_at: string }>({
  rows,
  decisionFor,
  isAnswered,
}: PartitionArgs<T>): ReviewQueuePartition<T> {
  const readyAgain: T[] = [];
  const firstReview: T[] = [];
  const awaitingSite: AwaitingSiteEntry<T>[] = [];

  for (const row of rows) {
    const decision = decisionFor(row.id);
    // Only an UNANSWERED needs_revision is somebody else's move. `approved` closes
    // the WP and `rejected` leaves pending_approval outright (spec 337 F3), so
    // neither should reach this queue — but if one ever does it stays visible and
    // actionable rather than disappearing into a zone nobody opens.
    if (decision?.decision === "needs_revision") {
      if (isAnswered(decision.id)) {
        readyAgain.push(row);
      } else {
        awaitingSite.push({
          row,
          bouncedAt: decision.decided_at,
          reason: decision.revision_reason,
        });
      }
      continue;
    }
    firstReview.push(row);
  }

  // Longest-stuck first — the awaiting zone is a chase list, so it ranks by how
  // long the site has been sitting on the ask, not by when the WP entered the queue.
  // Plain `<` like selectLatestDecisionByWorkPackage: localeCompare is ICU-collation
  // dependent and actually inverts across PostgREST's two fraction formats
  // ("…:22+00:00" vs "…:22.776778+00:00").
  awaitingSite.sort((a, b) => (a.bouncedAt < b.bouncedAt ? -1 : a.bouncedAt > b.bouncedAt ? 1 : 0));

  // The genuinely oldest actionable row, across BOTH groups — the CTA says
  // เริ่มตรวจงานเก่าสุด, so it must not mean "oldest ready-again, else oldest first
  // review". A cured bounce keeps its original queue-entry updated_at, so it can
  // easily be NEWER than the oldest never-reviewed WP (fresh-eyes catch: live, the
  // two were 11 minutes apart, which is the only reason it read correctly).
  const startHere = [...readyAgain, ...firstReview].reduce<T | null>(
    (oldest, row) => (oldest === null || row.updated_at < oldest.updated_at ? row : oldest),
    null,
  );

  return {
    readyAgain,
    firstReview,
    awaitingSite,
    actionableCount: readyAgain.length + firstReview.length,
    startHere,
    oldestActionableAt: startHere?.updated_at ?? null,
  };
}

/**
 * Whole **Asia/Bangkok calendar days** between an ISO stamp and `todayIso`.
 *
 * Calendar days, not elapsed 24-hour periods: `src/lib/dates.ts` fixes app dates to
 * Bangkok civil dates (spec 46 C7), the row renders `เข้าคิวเมื่อ` through the same
 * timezone, and the app's other aging chip (`poAgingDays`) already counts this way —
 * an elapsed-ms floor would render `รอมาแล้ว 0 วัน` beside a stamp dated yesterday.
 *
 * Clamped at 0 so clock skew reads "today" rather than a negative age, and null on an
 * unparseable stamp so a bad value renders as no chip instead of "NaN วัน".
 */
export function daysWaiting(iso: string, todayIso: string): number | null {
  if (Number.isNaN(Date.parse(iso))) return null;
  const from = Date.parse(`${bangkokDateOf(iso)}T00:00:00Z`);
  const to = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
