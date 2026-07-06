// Spec 273 U5 (ADR 0076) — resolve the /sa/plan ?date= param to the board date.
// The builder defaults to พรุ่งนี้ (the "plan tomorrow" habit) but is date-navigable
// so a SA can EDIT today's or any future board. Floor at today — a SA never edits a
// past day's operational plan. The param is untrusted (a URL) so reject anything
// malformed or calendar-invalid; ISO_DATE_REGEX is format-only, hence the round-trip.

import { ISO_DATE_REGEX } from "@/lib/dates";
import { addDaysIso } from "@/lib/work-packages/calendar-grid";

export function resolvePlanDate(param: string | undefined, todayIso: string): string {
  const tomorrow = addDaysIso(todayIso, 1);
  if (!param || !ISO_DATE_REGEX.test(param)) return tomorrow;

  // addDaysIso throws on a calendar-invalid string (NaN date); a rolled-over date
  // (e.g. 2026-02-30) normalises to a different day. Either way, fall back.
  let normalized: string;
  try {
    normalized = addDaysIso(param, 0);
  } catch {
    return tomorrow;
  }
  if (normalized !== param) return tomorrow;

  return param < todayIso ? tomorrow : param; // floor at today
}
