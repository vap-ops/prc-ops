// Spec 149 U2 / ADR 0057 — pure helpers for accounting periods. The UI gate
// before open_accounting_period / set_accounting_period_status; the DB RPCs +
// CHECK (period_month first-of-month) re-guard. Dates are ISO YYYY-MM-DD; no
// Date parsing (string slice — the `date` column is the real calendar guard).

export const PERIOD_STATUSES = ["open", "closing", "closed", "locked"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

// Normalize an ISO date to the first of its month. Assumes a YYYY-MM-DD input
// (caller-validated); slices the year-month and pins day 01.
export function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

// The legal period-status transition table (ADR 0057 decision 7). Mirrors
// set_accounting_period_status: open is postable; closing is the reconciliation
// window; closed rejects posts (super may reopen); locked is permanent (filed to
// PEAK). Transitions into `locked` and reopening a `closed` period are super-only.
// `locked` is terminal — no transition out, even for super. No-ops and unknown
// statuses are rejected.
export function canTransitionPeriod(from: string, to: string, isSuper: boolean): boolean {
  const statuses = PERIOD_STATUSES as readonly string[];
  if (!statuses.includes(from) || !statuses.includes(to)) return false;
  if (from === to) return false;

  switch (from) {
    case "open":
      return to === "closing";
    case "closing":
      return to === "open" || to === "closed";
    case "closed":
      // reopen or file — both super-only
      return (to === "open" || to === "locked") && isSuper;
    case "locked":
      return false;
    default:
      return false;
  }
}
