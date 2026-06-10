// Pure progress derivation for a deliverable from its member WPs'
// statuses (spec 12). No I/O, no React — the grouped WP list computes
// this from the FULL (unfiltered) membership so headers show true
// progress while filters are active; spec 04 Phase 3 (PDF grouping)
// can reuse it later.
//
// Status rule: `complete` iff every WP is complete (and there is at
// least one); `not_started` iff every WP is not_started (or the group
// is empty — degenerate, empty groups never render); `in_progress`
// otherwise (mixes, on_hold, pending_approval).

import type { Database } from "@/lib/db/database.types";

type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

export type DeliverableProgressStatus = "not_started" | "in_progress" | "complete";

export interface DeliverableProgress {
  status: DeliverableProgressStatus;
  completeCount: number;
  totalCount: number;
  percent: number;
}

export function deriveDeliverableProgress(
  statuses: ReadonlyArray<WorkPackageStatus>,
): DeliverableProgress {
  const totalCount = statuses.length;
  const completeCount = statuses.filter((s) => s === "complete").length;
  const percent = totalCount > 0 ? Math.round((100 * completeCount) / totalCount) : 0;

  let status: DeliverableProgressStatus;
  if (totalCount > 0 && completeCount === totalCount) {
    status = "complete";
  } else if (statuses.every((s) => s === "not_started")) {
    status = "not_started";
  } else {
    status = "in_progress";
  }

  return { status, completeCount, totalCount, percent };
}
