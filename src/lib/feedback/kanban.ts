// Spec 201 (review kanban) — the column model for the operator triage board. The
// four feedback_status values are the columns, in lifecycle order. Pure + testable;
// the board component renders from this.

import type { Database } from "@/lib/db/database.types";

type FeedbackStatus = Database["public"]["Enums"]["feedback_status"];

export const FEEDBACK_STATUS_ORDER: readonly FeedbackStatus[] = [
  "open",
  "in_progress",
  "done",
  "declined",
];

export type FeedbackColumn<T> = { status: FeedbackStatus; items: T[] };

// Always returns all four columns (empty ones included), in lifecycle order, with
// each input card placed under its status and input order preserved within a column.
export function groupFeedbackByStatus<T extends { status: FeedbackStatus }>(
  cards: readonly T[],
): FeedbackColumn<T>[] {
  return FEEDBACK_STATUS_ORDER.map((status) => ({
    status,
    items: cards.filter((c) => c.status === status),
  }));
}
