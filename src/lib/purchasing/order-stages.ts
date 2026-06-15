// Spec 111 — the order lifecycle stage-state logic, extracted from the spec-22
// PurchaseRequestTracker so the tracker and the grid mini-bar share ONE source
// of truth (no duplicated STATUS_RANK / rejected-cancelled rules). Pure.

import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export const ORDER_STAGES = [
  "requested",
  "approved",
  "purchased",
  "on_route",
  "delivered",
] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];

export type OrderStageState = "done" | "pending" | "rejected" | "cancelled";

// How far each status reaches (index into ORDER_STAGES). rejected/cancelled stop
// after the decision stage; site_purchased didn't walk this pipeline but is
// ranked terminal for the type's sake (the detail page hides the stepper for it).
const STATUS_RANK: Record<PurchaseRequestStatus, number> = {
  requested: 0,
  approved: 1,
  rejected: 1,
  cancelled: 1,
  purchased: 2,
  on_route: 3,
  delivered: 4,
  site_purchased: 4,
};

export interface OrderStageStep {
  stage: OrderStage;
  state: OrderStageState;
  isCurrent: boolean;
  /** done or the rejected terminal — i.e. the pipeline reached this step. */
  reached: boolean;
}

// Per-stage state for a status. rejected replaces the approve stage with a red
// terminal and mutes the rest; cancelled keeps the reached stages done and mutes
// the rest (administrative close, not a refusal).
export function orderStageStates(status: PurchaseRequestStatus): OrderStageStep[] {
  const rank = STATUS_RANK[status];
  const rejected = status === "rejected";
  const cancelled = status === "cancelled";
  return ORDER_STAGES.map((stage, i) => {
    const state: OrderStageState = rejected
      ? i < 1
        ? "done"
        : i === 1
          ? "rejected"
          : "cancelled"
      : cancelled
        ? i <= rank
          ? "done"
          : "cancelled"
        : i <= rank
          ? "done"
          : "pending";
    const isCurrent = rejected ? i === 1 : i === rank;
    const reached = state === "done" || state === "rejected";
    return { stage, state, isCurrent, reached };
  });
}
