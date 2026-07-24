// Spec 306 ปิดวัน discoverability — the pure state machine for the sticky
// close-day bar. Day-1 field failure (2026-07-24): the SA checked all 13 workers
// out (the day felt done) but never pressed ปิดวัน, so no closure was recorded
// and the money derive never fired. The bar highlights at the exact moment the
// SA's own actions signal "done" = every checked-in worker is checked out.
//
// Pure + client-safe (the "use client" cockpit value-imports it — the #742
// server-only-in-the-client-bundle build lesson). `pastDayEnd` is passed in
// (computed server-side in the page) so this stays deterministic and testable —
// no clock read here.

export type CloseDayKind = "in_progress" | "ready" | "overdue" | "closed";

export interface CloseDayState {
  kind: CloseDayKind;
  /** Regular sessions checked in but not yet out. */
  stillIn: number;
  /** OT sessions still open (in, no out) — close_muster_day never auto-outs OT. */
  openOt: number;
  closedAt: string | null;
}

interface StateInput {
  teams: ReadonlyArray<{
    members: ReadonlyArray<{
      inAt: string | null;
      outAt: string | null;
      ot: { inAt: string | null; outAt: string | null } | null;
    }>;
  }>;
  closure: { closedAt: string } | null;
  /** Server-computed: is it past the 17:00 Asia/Bangkok day-end? */
  pastDayEnd: boolean;
}

export function deriveCloseDayState(input: StateInput): CloseDayState {
  const members = input.teams.flatMap((t) => t.members);
  const checkedIn = members.filter((m) => m.inAt);
  const stillIn = checkedIn.filter((m) => !m.outAt).length;
  const openOt = members.filter((m) => m.ot && m.ot.inAt && !m.ot.outAt).length;
  const closedAt = input.closure?.closedAt ?? null;

  let kind: CloseDayKind;
  if (closedAt) {
    // A recorded closure always wins — even if someone re-checked in after, the
    // SA sees ปิดวันแล้ว and can re-close (close_muster_day is idempotent).
    kind = "closed";
  } else if (checkedIn.length > 0 && stillIn === 0) {
    // The "done" moment: everyone who came is checked out. Self-correcting — a
    // re-check-in flips stillIn back above 0 and the highlight recedes.
    kind = "ready";
  } else if (input.pastDayEnd && stillIn > 0) {
    // Past day-end and workers are still shown as in — the SA may be relying on
    // the 17:00 auto-out. Nudge them to close (auto-out cleans up the stragglers).
    kind = "overdue";
  } else {
    kind = "in_progress";
  }

  return { kind, stillIn, openOt, closedAt };
}
