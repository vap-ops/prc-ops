// Pure predicates and display labels for the PM report UI. Shared by the
// generateReport server action (server-side duplicate guard), the reports
// list (status pills + auto-poll decision), and the unit tests. Same
// shape as src/lib/approvals/predicates.ts — predicate decides, action
// reinforces.

import type { Database } from "@/lib/db/database.types";

export type ReportStatus = Database["public"]["Enums"]["report_status"];

// The two states the Railway worker hasn't finished with yet. A report
// is "in flight" iff it's been requested but no terminal state (complete
// or failed) has been recorded. The duplicate guard refuses a new
// generate when ANY existing report for the project is in this set; the
// auto-poll keeps refreshing while ANY visible report is in this set.
export const REPORT_IN_FLIGHT_STATUSES: ReadonlyArray<ReportStatus> = ["requested", "processing"];

export function isReportInFlight(status: ReportStatus): boolean {
  return (REPORT_IN_FLIGHT_STATUSES as ReadonlyArray<string>).includes(status);
}

// Duplicate guard: given the statuses of every existing report for a
// project, can the caller generate a new one? The rule is "no two
// in-flight reports per project at the same time" — terminal reports
// (complete / failed) don't block a fresh generate.
export function canGenerateReport(existingStatuses: ReadonlyArray<ReportStatus>): boolean {
  return !existingStatuses.some(isReportInFlight);
}

// Human label for each enum value. Used by the status pill in the
// reports list and by any future surface that displays a report's state.
export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  requested: "อยู่ในคิว",
  processing: "กำลังสร้าง",
  complete: "พร้อมดาวน์โหลด",
  failed: "ล้มเหลว",
};
