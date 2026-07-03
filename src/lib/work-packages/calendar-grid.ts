// Spec 256 U1 — pure calendar grid + nav helpers for the real calendar views
// (เดือน/สัปดาห์/วัน). Sunday-first weeks (Thai wall-calendar convention),
// Buddhist-era month labels, UTC-ms date math — same conventions as
// gantt-scale (app dates are Bangkok calendar dates as YYYY-MM-DD strings;
// arithmetic happens in DST-free UTC ms).

import { THAI_MONTHS } from "@/lib/work-packages/gantt-scale";

/** Sunday-first Thai weekday abbreviations. */
export const THAI_WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;

const DAY_MS = 86_400_000;

function parseDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}
function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return toIso(parseDay(iso) + days * DAY_MS);
}

/** Same day-of-month in the shifted month, clamped to that month's last day. */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(parseDay(iso));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toIso(Date.UTC(y, m, Math.min(day, lastDay)));
}

export interface MonthGridCell {
  iso: string;
  day: number;
  inMonth: boolean;
  isWeekend: boolean;
}

export interface MonthGrid {
  /** BE month label, e.g. "ก.ค. 2569". */
  label: string;
  /** Sunday-first weeks covering the anchor's month. */
  weeks: MonthGridCell[][];
}

export function monthGrid(anchorIso: string): MonthGrid {
  const a = new Date(parseDay(anchorIso));
  const y = a.getUTCFullYear();
  const m = a.getUTCMonth();
  const firstMs = Date.UTC(y, m, 1);
  const lastMs = Date.UTC(y, m + 1, 0);
  // back up to the Sunday on/before the 1st
  let cur = firstMs - new Date(firstMs).getUTCDay() * DAY_MS;

  const weeks: MonthGridCell[][] = [];
  while (cur <= lastMs) {
    const week: MonthGridCell[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cur);
      const dow = d.getUTCDay();
      week.push({
        iso: toIso(cur),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === m,
        isWeekend: dow === 0 || dow === 6,
      });
      cur += DAY_MS;
    }
    weeks.push(week);
  }

  return { label: `${THAI_MONTHS[m]} ${y + 543}`, weeks };
}

/** The Sunday-first 7-day week containing the anchor date. */
export function weekOf(anchorIso: string): string[] {
  const ms = parseDay(anchorIso);
  const start = ms - new Date(ms).getUTCDay() * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => toIso(start + i * DAY_MS));
}
