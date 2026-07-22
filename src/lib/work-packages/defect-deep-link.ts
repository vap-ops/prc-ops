// Spec 337 U5 — the defect deep link, as ONE module shared by both ends.
//
// The project WP list's เสร็จแล้ว band offers a door per finished งานย่อย; the WP
// detail page reads the param back and opens the existing ReportDefectControl
// sheet on arrival. Producer and consumer live here together on purpose: a query
// key that drifted between them would render a door that silently opens nothing,
// and nothing in the type system would notice.
//
// Audit finding F6 (2026-07-22): reopen_work_package_for_defect has never been
// used on prod — the machinery works, the door was just somewhere nobody stands.

import { workPackageHref } from "@/lib/nav/project-paths";

/** The query key the door emits and the WP detail reads. */
export const DEFECT_PARAM = "defect";

/**
 * The only value that opens the sheet. Anything else is ignored silently — the
 * page renders normally rather than erroring on a hand-edited URL.
 */
const DEFECT_PARAM_OPEN = "1";

/** The WP detail href that lands with the defect sheet already open. */
export function defectHref(projectId: string, workPackageId: string): string {
  return `${workPackageHref(projectId, workPackageId)}?${DEFECT_PARAM}=${DEFECT_PARAM_OPEN}`;
}

/**
 * Whether an arriving `?defect=` value asks for the sheet. The page still gates
 * on status + role — this answers only "was the sheet requested".
 *
 * Next hands a repeated query key (`?defect=1&defect=1`) through as an array, so
 * the parameter is typed the way the framework actually delivers it; anything
 * that is not exactly the declared scalar reads as "not requested".
 */
export function shouldOpenDefectSheet(value: string | string[] | undefined): boolean {
  return value === DEFECT_PARAM_OPEN;
}
