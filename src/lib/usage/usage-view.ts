// Spec 244 U1b-2 / ADR 0068 (Tier B) — pure view helpers behind the super_admin
// usage read. They turn `usage_daily` rows into a DAU-per-day series + a per-SA
// summary, and format screen time for humans (Thai). No DB / Date access here —
// the caller passes the day window in — so the shaping logic is unit-testable.
//
// Framing note (ADR 0068 §5): this is a SUPPORT read ("who might need a
// check-in", "is the app being used"), never a productivity score. The per-SA
// list is sorted by name, not by any usage metric, on purpose — no leaderboard.

export interface UsageDailyRow {
  actorId: string;
  name: string;
  day: string; // 'YYYY-MM-DD'
  sessions: number;
  active: boolean;
  screenTimeMs: number;
}

export interface DauPoint {
  day: string;
  count: number;
}

export interface PerSaUsage {
  actorId: string;
  name: string;
  activeDays: number;
  totalScreenTimeMs: number;
  totalSessions: number;
  lastActiveDay: string | null;
}

export interface UsageSummary {
  dau: DauPoint[];
  perSa: PerSaUsage[];
  peakDau: number;
  totalActiveSas: number;
}

// Distinct active actors per day (DAU) across the window + a per-SA rollup.
export function summarizeUsage(rows: UsageDailyRow[], windowDays: string[]): UsageSummary {
  const activeByDay = new Map<string, Set<string>>();
  for (const day of windowDays) activeByDay.set(day, new Set());
  for (const r of rows) {
    if (!r.active) continue;
    activeByDay.get(r.day)?.add(r.actorId);
  }
  const dau: DauPoint[] = windowDays.map((day) => ({
    day,
    count: activeByDay.get(day)?.size ?? 0,
  }));

  const byActor = new Map<string, PerSaUsage>();
  for (const r of rows) {
    let acc = byActor.get(r.actorId);
    if (!acc) {
      acc = {
        actorId: r.actorId,
        name: r.name,
        activeDays: 0,
        totalScreenTimeMs: 0,
        totalSessions: 0,
        lastActiveDay: null,
      };
      byActor.set(r.actorId, acc);
    }
    acc.totalScreenTimeMs += r.screenTimeMs;
    acc.totalSessions += r.sessions;
    if (r.active) {
      acc.activeDays += 1;
      if (acc.lastActiveDay === null || r.day > acc.lastActiveDay) acc.lastActiveDay = r.day;
    }
  }
  const perSa = [...byActor.values()].sort((a, b) => a.name.localeCompare(b.name, "th"));

  const peakDau = dau.reduce((m, p) => Math.max(m, p.count), 0);
  const totalActiveSas = perSa.filter((p) => p.activeDays > 0).length;

  return { dau, perSa, peakDau, totalActiveSas };
}

// Screen time -> a short Thai duration. Screen time is a coarse foreground-visible
// proxy (heartbeats × 20s), so whole-unit rounding is honest enough.
export function formatScreenTime(ms: number): string {
  if (ms < 60_000) {
    if (ms <= 0) return "0 นาที";
    return `${Math.round(ms / 1_000)} วินาที`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)} นาที`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return minutes === 0 ? `${hours} ชม.` : `${hours} ชม. ${minutes} นาที`;
}
