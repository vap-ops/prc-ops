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
// Kept free of `server-only` so it stays importable from the "use client" banner.
// Today the banner only imports the TYPE (erased at compile time), so nothing
// currently forces the issue — this is a constraint held deliberately, not one
// the build is proving. If a value ever crosses over, note that `server-only` in
// a client bundle typechecks green and fails `next build` (the spec-306 #742
// lesson), which is why the constraint is worth keeping ahead of need.
//
// LOOKBACK IS DELIBERATELY UNBOUNDED. A 30-day cap shipped here first and was
// wrong: past the cap a day became permanently unbookable, because closing is the
// ONLY way to produce the closure row `derive_muster_labor` keys off, and
// The cap was justified on `/team/attendance` being an all-time fallback; it is
// not one. That report defaults to MONTH-TO-DATE and its role set excludes
// `site_admin` — the very actor who misses ปิดวัน. So a cap would re-create the
// exact failure this feature exists to prevent.
// ⚠️ CORRECTED 2026-08-06 (spec 400 U3b): that report DOES now carry a close
// action, on its `?day=` panel, so `close_muster_day` has three callers and the
// clause "renders a count with no close action" is retired. The ruling is
// unchanged — the site_admin exclusion is what carries it, and U3b's panel is
// past-days-only and gated on MUSTER_CLOSE_ROLES. The list is instead bounded where it costs nothing: the banner
// RENDERS the newest few and summarises the rest, and each close reveals the next.

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
}): UnclosedPriorDay[] {
  const closed = new Set(raw.closedDates);
  const isPrior = (date: string) => date < raw.today;
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
