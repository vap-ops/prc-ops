// Shared calendar-date primitives (spec 65). App dates are Asia/Bangkok
// calendar dates, never UTC (spec 46 C7). Wrapped in lib functions (not
// component scope) per the React Compiler lint convention.
// bangkokTodayIso previously existed in three copies; ISO_DATE_REGEX in
// three. labor/dates.ts re-exports for compat.

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function bangkokTodayIso(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

// Spec 68 — an ISO timestamp's Asia/Bangkok (UTC+7) calendar date. The
// close-out variance strip buckets photo capture timestamps to the same
// timezone labor work_dates are recorded in (spec 46 C7), so the day sets
// compare cleanly.
export function bangkokDateOf(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date(iso));
}

// Spec 277 — the current Asia/Bangkok hour (0–23). The SA home nudges the "ปิดวัน"
// tile with a gentle pulse after ~16:00; the pulse is time-based but the column
// order is not (structure never reshuffles by clock). hour12:false renders 00–23
// but some ICU builds emit "24" at midnight, so wrap.
export function bangkokHour(date: Date = new Date()): number {
  const hh = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number.parseInt(hh, 10) % 24;
}
