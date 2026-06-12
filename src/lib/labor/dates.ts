// Spec 46 C7 — labor days are Asia/Bangkok calendar dates, never UTC.
// Wrapped in a lib function (not component scope) per the React
// Compiler lint convention.

export function bangkokTodayIso(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}
