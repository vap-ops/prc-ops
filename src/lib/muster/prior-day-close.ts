// Spec 306 close-day carryover — the pure fold behind the cockpit's
// "ยังไม่ได้ปิดวันทำงานที่ผ่านมา" banner.
//
// The field failure this exists for, seen twice running on PRC-2026-004
// (2026-07-24 and 2026-07-25): the SA checks everyone out — the day is "done" in
// their head — but never presses ปิดวัน, so no `muster_day_closures` row is
// written and `derive_muster_labor` can never fire for that date. The cockpit is
// hard-locked to bangkokTodayIso(), so the moment midnight passes the missed day
// becomes UI-unreachable and nothing anywhere surfaces it to the SA again.
//
// A day is only ever listed if a team was actually opened on it — days nobody
// mustered (a Sunday, a holiday) have no muster_teams rows at all, so this can
// never nag about a day that was never worked.
//
// Client-safe on purpose: the "use client" banner value-imports this, and a
// server-only module pulled into the client bundle typechecks green but fails
// `next build` (the spec-306 #742 lesson). Keep this file free of `server-only`.

/**
 * How far back the cockpit banner looks. A BOUNDARY, not a silent truncation:
 * this is the SA's daily nudge, and without a floor the reader would fetch every
 * muster day the project has ever had on every cockpit load, forever. A day still
 * unclosed after a month has stopped being "the SA forgot last night" and is a
 * payroll-audit matter — `/team/attendance` carries the all-time unclosed-day
 * signal for the office roles that reconcile it.
 */
export const CLOSE_CARRYOVER_WINDOW_DAYS = 30;

/** The oldest work_date the banner will offer, inclusive. */
export function carryoverWindowStart(
  today: string,
  days: number = CLOSE_CARRYOVER_WINDOW_DAYS,
): string {
  // UTC-anchored arithmetic on a plain calendar date — the input is already an
  // Asia/Bangkok day, so there is no zone to re-apply and no DST to drift on.
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface UnclosedPriorDay {
  /** The muster work_date (ISO, Asia/Bangkok calendar day). */
  date: string;
  teamCount: number;
  /**
   * OT sessions on that day that were checked in and never checked out.
   * `close_muster_day` deliberately auto-outs REGULAR sessions only, so these
   * spans have no end recorded and closing the day cannot book them — the
   * banner's confirmation discloses that rather than implying it can be avoided.
   */
  openOt: number;
}

interface RawPriorTeam {
  id: string;
  work_date: string;
}
interface RawSession {
  team_id: string;
  session: "regular" | "ot";
  in_at: string | null;
  out_at: string | null;
}

export function shapeUnclosedPriorDays(raw: {
  priorTeams: ReadonlyArray<RawPriorTeam>;
  /** work_date values that already have a `muster_day_closures` row. */
  closedDates: ReadonlyArray<string>;
  attendance: ReadonlyArray<RawSession>;
  /**
   * The cockpit's own working date (bangkokTodayIso). REQUIRED, and enforced
   * here rather than trusted from the caller's `lt` filter: today has its own
   * ปิดวัน bar, and nagging the SA to close the day they are standing in would
   * be worse than the miss this banner exists to catch.
   */
  today: string;
  /**
   * The oldest work_date to consider, inclusive (see CLOSE_CARRYOVER_WINDOW_DAYS).
   * Enforced here as well as in the reader's query for the same reason as
   * `today`: the window is part of this function's contract, not something it
   * infers from whatever rows it happens to be handed.
   */
  since: string;
}): UnclosedPriorDay[] {
  const closed = new Set(raw.closedDates);
  const isPrior = (date: string) => date < raw.today && date >= raw.since;
  // team id → work_date, so an attendance row can be attributed to its day.
  const dateOfTeam = new Map(raw.priorTeams.map((t) => [t.id, t.work_date]));
  const counts = (date: string) => isPrior(date) && !closed.has(date);

  const teamCountByDate = new Map<string, number>();
  for (const t of raw.priorTeams) {
    if (!counts(t.work_date)) continue;
    teamCountByDate.set(t.work_date, (teamCountByDate.get(t.work_date) ?? 0) + 1);
  }

  const openOtByDate = new Map<string, number>();
  for (const a of raw.attendance) {
    if (a.session !== "ot" || !a.in_at || a.out_at) continue;
    const date = dateOfTeam.get(a.team_id);
    if (!date || !counts(date)) continue;
    openOtByDate.set(date, (openOtByDate.get(date) ?? 0) + 1);
  }

  return (
    [...teamCountByDate.entries()]
      .map(([date, teamCount]) => ({ date, teamCount, openOt: openOtByDate.get(date) ?? 0 }))
      // Newest first: the SA's most recent miss is the one they can still remember
      // well enough to judge whether the recorded times look right.
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  );
}
