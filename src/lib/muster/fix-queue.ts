/**
 * Spec 400 U7 — the fix panel's QUEUE: the order the panel walks a day's people,
 * and where a save lands.
 *
 * Pure on purpose. The panel itself is a Server Component the suite cannot
 * render, and U1 already proved a source scan cannot see reachability — so the
 * decision of who comes next lives here, where every arm can be driven directly.
 *
 * ⚠️ THE QUEUE IS THE DAY'S ROSTER, NOT `dayWorkList` (spec §D20). D18's first
 * answer was to walk the anomaly list; the gate-check refuted it. `dayWorkList`
 * carries exactly `openOut`, and ZERO sessions in the database have a null
 * `out_at` — so an anomalies-only queue advances through nothing on every day
 * that exists today. Anomalies survive as the ORDERING signal instead, which is
 * also what the 2026-07-24 sitting did by hand: 9 OT rows first, out of the 13
 * workers on that day.
 */

export interface FixQueueRow {
  workerId: string;
  workerName: string;
  /** On the day's anomaly list (`dayWorkList`) — sorts first, and only that. */
  problem: boolean;
}

/**
 * The day's workers, anomalies first, then by name.
 *
 * Thai collation (`localeCompare(…, "th")`), matching `dayWorkList`'s own sort —
 * code-point order puts Thai vowels in front of the consonants they follow.
 */
export function fixQueue(input: {
  roster: readonly { workerId: string; workerName: string }[];
  /** Worker ids from `dayWorkList` — an id that is not on the day is ignored. */
  anomalies: readonly string[];
}): FixQueueRow[] {
  const flagged = new Set(input.anomalies);
  const rows: FixQueueRow[] = input.roster.map((r) => ({
    workerId: r.workerId,
    workerName: r.workerName,
    problem: flagged.has(r.workerId),
  }));
  return rows.sort((a, b) => {
    if (a.problem !== b.problem) return a.problem ? -1 : 1;
    return a.workerName.localeCompare(b.workerName, "th");
  });
}

/**
 * Where the panel opens after a save that asked to advance.
 *
 * `null` means "no advance was requested" — the reader opened the panel by
 * tapping a cell, so the panel stays where the URL put it.
 *
 * ⚠️ Called with the queue rebuilt from POST-WRITE data, never a target computed
 * before the write (§D18). A correction that resolved nothing leaves its worker
 * on the queue, so they come round again on a later pass rather than being
 * silently dropped — and a correction that DELETED the worker-day (the undo
 * path) takes them off the roster entirely, which is why an unknown `justSaved`
 * falls back to the head instead of dead-ending.
 */
export function nextFixTarget(input: {
  queue: readonly FixQueueRow[];
  justSaved: string | null;
}): { workerId: string } | { done: true } | null {
  if (input.justSaved === null) return null;
  const head = input.queue[0];
  if (head === undefined) return { done: true };

  const at = input.queue.findIndex((r) => r.workerId === input.justSaved);
  if (at === -1) return { workerId: head.workerId };

  const next = input.queue[at + 1];
  return next === undefined ? { done: true } : { workerId: next.workerId };
}
