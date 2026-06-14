// Spec 92 Unit D — Gantt timeline scale (pure). Maps planned dates to x-pixels
// for the schedule calendar, builds the month band + day-tick axis, and switches
// granularity by period (เดือน / ไตรมาส / ปี — the KANNA-style control). Pure +
// deterministic: `today` is passed in, so it unit-tests cleanly. Years render in
// Buddhist era (Gregorian + 543) — the app's convention (e.g. project 2569).

export type SchedulePeriod = "month" | "quarter" | "year";

export interface PeriodConfig {
  readonly key: SchedulePeriod;
  readonly label: string;
  readonly dayWidth: number;
  readonly showDays: boolean;
}

export const SCHEDULE_PERIODS: readonly PeriodConfig[] = [
  { key: "month", label: "เดือน", dayWidth: 30, showDays: true },
  { key: "quarter", label: "ไตรมาส", dayWidth: 9, showDays: false },
  { key: "year", label: "ปี", dayWidth: 3, showDays: false },
];

const THAI_MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];
const DAY_MS = 86_400_000;

function parseDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}
function dayDiff(aMs: number, bMs: number): number {
  return Math.round((aMs - bMs) / DAY_MS);
}

export interface ScheduleBar {
  x: number;
  width: number;
}
export interface TimelineItem {
  plannedStart: string | null;
  plannedEnd: string | null;
}
export interface MonthBand {
  label: string;
  x: number;
  width: number;
}
export interface DayTick {
  x: number;
  day: number;
  isWeekend: boolean;
}
export interface Timeline {
  domainStartMs: number;
  dayWidth: number;
  showDays: boolean;
  widthPx: number;
  months: MonthBand[];
  days: DayTick[];
  /** x of the today line, or null if today is outside the domain. */
  todayX: number | null;
  /** width of the past-shading rectangle from x=0, clamped to the timeline. */
  pastWidth: number;
}

/** Bar geometry for a WP, or null if it has no planned window. Inclusive days. */
export function barFor(
  item: TimelineItem,
  domainStartMs: number,
  dayWidth: number,
): ScheduleBar | null {
  if (!item.plannedStart || !item.plannedEnd) return null;
  const s = parseDay(item.plannedStart);
  const e = parseDay(item.plannedEnd);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  const x = dayDiff(s, domainStartMs) * dayWidth;
  const days = Math.max(1, dayDiff(e, s) + 1);
  return { x, width: days * dayWidth };
}

/** Build the timeline (domain padded to whole months) for a period + today. */
export function buildTimeline(
  items: readonly TimelineItem[],
  period: SchedulePeriod,
  todayISO: string,
): Timeline {
  const cfg = SCHEDULE_PERIODS.find((p) => p.key === period) ?? SCHEDULE_PERIODS[0]!;
  const todayMs = parseDay(todayISO);

  const dates: number[] = [];
  for (const it of items) {
    if (it.plannedStart) {
      const m = parseDay(it.plannedStart);
      if (!Number.isNaN(m)) dates.push(m);
    }
    if (it.plannedEnd) {
      const m = parseDay(it.plannedEnd);
      if (!Number.isNaN(m)) dates.push(m);
    }
  }
  // No scheduled WP → empty timeline (the component shows an empty state);
  // today only widens the domain when there is at least one bar to place.
  if (dates.length === 0) {
    return {
      domainStartMs: Number.isNaN(todayMs) ? 0 : todayMs,
      dayWidth: cfg.dayWidth,
      showDays: cfg.showDays,
      widthPx: 0,
      months: [],
      days: [],
      todayX: null,
      pastWidth: 0,
    };
  }
  if (!Number.isNaN(todayMs)) dates.push(todayMs);

  const min = Math.min(...dates);
  const max = Math.max(...dates);
  const minD = new Date(min);
  const maxD = new Date(max);
  const padStartMs = Date.UTC(minD.getUTCFullYear(), minD.getUTCMonth(), 1);
  const padEndMs = Date.UTC(maxD.getUTCFullYear(), maxD.getUTCMonth() + 1, 0); // last day of max's month
  const totalDays = dayDiff(padEndMs, padStartMs) + 1;
  const widthPx = totalDays * cfg.dayWidth;

  const months: MonthBand[] = [];
  let cur = padStartMs;
  while (cur <= padEndMs) {
    const d = new Date(cur);
    const mStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const mEndMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    const x = dayDiff(mStartMs, padStartMs) * cfg.dayWidth;
    const width = (dayDiff(mEndMs, mStartMs) + 1) * cfg.dayWidth;
    const beYear = (d.getUTCFullYear() + 543) % 100;
    months.push({
      label: `${THAI_MONTHS[d.getUTCMonth()]} ${beYear.toString().padStart(2, "0")}`,
      x,
      width,
    });
    cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }

  const days: DayTick[] = [];
  if (cfg.showDays) {
    for (let i = 0; i < totalDays; i++) {
      const dt = new Date(padStartMs + i * DAY_MS);
      const dow = dt.getUTCDay();
      days.push({ x: i * cfg.dayWidth, day: dt.getUTCDate(), isWeekend: dow === 0 || dow === 6 });
    }
  }

  const todayX = Number.isNaN(todayMs) ? null : dayDiff(todayMs, padStartMs) * cfg.dayWidth;
  const pastWidth = todayX === null ? 0 : Math.max(0, Math.min(widthPx, todayX));

  return {
    domainStartMs: padStartMs,
    dayWidth: cfg.dayWidth,
    showDays: cfg.showDays,
    widthPx,
    months,
    days,
    todayX,
    pastWidth,
  };
}
