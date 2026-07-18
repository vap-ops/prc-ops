// Spec 327 U5 — the equipment period check (pure). PROJECT grain by design
// (allocations are project-bound; a WP-grain compare has no join — 323 D6).
// A rental whose effective end lands BEFORE the project's planned completion
// flags amber — the gap invites the extend/record door beside it (§0.2). An
// open-ended rental (null end) and a null project end never flag; non-active
// batches are history and are excluded entirely.

export interface RentalPeriodRow {
  id: string;
  /** Effective end: allocation ends_on ?? batch ends_on (caller coalesces). */
  endsOn: string | null;
  status: string;
}

export function flagRentalPeriodGaps<T extends RentalPeriodRow>(
  rows: ReadonlyArray<T>,
  projectEnd: string | null,
): Array<T & { gap: boolean }> {
  return rows
    .filter((r) => r.status === "active")
    .map((r) => ({
      ...r,
      gap: projectEnd !== null && r.endsOn !== null && r.endsOn < projectEnd,
    }));
}
