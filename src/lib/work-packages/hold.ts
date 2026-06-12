// Pure helpers for the PM on-hold toggle (spec 52 part B).
//
// canHold / canRelease predicate the two manual transitions; the server
// action mirrors each with a SQL WHERE guard so the rule holds in two
// independent layers (the option-(a) shape from spec 03, minus the
// admin escalation — work_packages UPDATE RLS already admits pm/super).
//
// deriveReleaseStatus: release re-derives instead of snapshotting the
// pre-hold status. After spec 52 part A, in_progress means exactly
// "current During photos exist" — so a released WP lands back on
// whichever side of that line it is actually on. Before photos are
// staging (เตรียมงาน, spec 10), not work happening.

import type { Database } from "@/lib/db/database.types";

export type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

export const HOLDABLE_FROM_STATUSES = ["not_started", "in_progress"] as const;

export function canHold(status: WorkPackageStatus): boolean {
  return (HOLDABLE_FROM_STATUSES as readonly string[]).includes(status);
}

export function canRelease(status: WorkPackageStatus): boolean {
  return status === "on_hold";
}

export function deriveReleaseStatus(
  hasCurrentDuringPhotos: boolean,
): Extract<WorkPackageStatus, "in_progress" | "not_started"> {
  return hasCurrentDuringPhotos ? "in_progress" : "not_started";
}
