// ReportParams (spec 61): what the PM chose to include. Stored on the
// reports row as jsonb, written once at INSERT; every reader parses
// defensively — pre-61 rows carry '{}' and must render the legacy
// report. parseReportParams never throws.

export type ReportScope = "complete" | "all";
// Spec 394 U3 — "selected" is the 4th mode: the photos a PD/PM picked for THIS
// client, in the order they arranged them. The other three are rules over
// phases and are untouched by construction.
export type ReportPhotosMode = "after" | "all_phases" | "none" | "selected";

export interface ReportParams {
  scope: ReportScope;
  photos: ReportPhotosMode;
  /** Spec 394 D7 — one free-text passage printed once, after the project
   *  header and before the first section. Lives in the existing `params`
   *  jsonb, so it needs NO schema change — and being stored on the report
   *  rather than the project gives it the right lifetime: an old PDF keeps
   *  the note it was sent with. Absent when unset; never an empty string,
   *  because the builder prints nothing rather than an empty heading. */
  coverNote?: string;
}

export const DEFAULT_REPORT_PARAMS: ReportParams = { scope: "complete", photos: "after" };

const SCOPES: ReadonlyArray<ReportScope> = ["complete", "all"];
const PHOTO_MODES: ReadonlyArray<ReportPhotosMode> = ["after", "all_phases", "none", "selected"];

export function parseReportParams(value: unknown): ReportParams {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const scope = (SCOPES as readonly unknown[]).includes(record["scope"])
    ? (record["scope"] as ReportScope)
    : DEFAULT_REPORT_PARAMS.scope;
  const photos = (PHOTO_MODES as readonly unknown[]).includes(record["photos"])
    ? (record["photos"] as ReportPhotosMode)
    : DEFAULT_REPORT_PARAMS.photos;
  // Spec 394 D7: trim, then OMIT the key when there is nothing to print —
  // `exactOptionalPropertyTypes` forbids passing an explicit undefined, and a
  // stored "" would make the builder decide "is this blank?" on every read.
  const rawNote = record["coverNote"];
  const coverNote = typeof rawNote === "string" ? rawNote.trim() : "";
  return coverNote ? { scope, photos, coverNote } : { scope, photos };
}
