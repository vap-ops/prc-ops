// Decision logic for the photo-driven WP status transition (spec 03
// decision 14). When the first After photo lands on a WP whose status
// is not_started / in_progress / on_hold, the addPhoto action flips it
// to pending_approval. Already-pending / already-complete WPs are
// never regressed.
//
// Per spec 03 decision 15 the operator picked option (a) — admin-
// client escalation INSIDE the upload server action. The transition
// itself is a single guarded UPDATE (this decision predicates it; the
// SQL guard in the action mirrors it so the rule is enforced in two
// independent layers).

import type { Database } from "@/lib/db/database.types";

export type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];
export type PhotoPhase = Database["public"]["Enums"]["photo_phase"];

export const TRANSITIONABLE_FROM_STATUSES = ["not_started", "in_progress", "on_hold"] as const;

export function shouldTransitionToPendingApproval(
  phase: PhotoPhase,
  currentStatus: WorkPackageStatus,
): boolean {
  if (phase !== "after") return false;
  return (TRANSITIONABLE_FROM_STATUSES as readonly string[]).includes(currentStatus);
}
