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
