// ReportParams (spec 61): what the PM chose to include. Stored on the
// reports row as jsonb, written once at INSERT; every reader parses
// defensively — pre-61 rows carry '{}' and must render the legacy
// report. parseReportParams never throws.

export type ReportScope = "complete" | "all";
export type ReportPhotosMode = "after" | "all_phases" | "none";

export interface ReportParams {
  scope: ReportScope;
  photos: ReportPhotosMode;
}

export const DEFAULT_REPORT_PARAMS: ReportParams = { scope: "complete", photos: "after" };

const SCOPES: ReadonlyArray<ReportScope> = ["complete", "all"];
const PHOTO_MODES: ReadonlyArray<ReportPhotosMode> = ["after", "all_phases", "none"];

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
  return { scope, photos };
}
