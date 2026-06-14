// Field-First action-state lens — pure helpers over the WP list props.
//
// The operator's real question on the worklist is "what needs MY action
// right now?". This maps each WP's status to an ACTION BAND and orders
// the actionable band by the supplied universal priority rank, so every
// role sees the highest-leverage work first.
//
// PURE: no fetch, no compute of priority. `priorityRank` / `isCritical`
// are SUPPLIED by the data layer (a separate priority-engine spec owns
// the derivation + migration). This module only consumes and orders.
//
// WP status enum (SDD §2.4): not_started → in_progress → pending_approval
// → complete, plus on_hold (manual). needs_revision/rejected are approval
// decisions, not statuses — a returned WP sits at pending_approval, so it
// correctly lands in the "review" band until the SA re-captures (which
// flips it back through the normal transition).

import type { Database } from "@/lib/db/database.types";

export type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];

/** Manual operator-set urgency flag (data layer supplies it). */
export type WpPriority = "normal" | "urgent" | "critical";

/** Action bands, in render order. */
export type ActionBand = "todo" | "held" | "review" | "done";

export const ACTION_BAND_ORDER: readonly ActionBand[] = ["todo", "held", "review", "done"];

interface BandMeta {
  /** Thai band heading, arm's-length legible. */
  label: string;
  /** Token spine colour utility for rows in this band. */
  spine: string;
  /** Token count-pill background utility. */
  countBg: string;
  /** Done band collapses to a summary row by default. */
  collapsible: boolean;
}

export const ACTION_BAND_META: Record<ActionBand, BandMeta> = {
  todo: { label: "ต้องทำเลย", spine: "bg-attn", countBg: "bg-attn-press", collapsible: false },
  held: {
    label: "พักงานชั่วคราว",
    spine: "bg-ink-muted",
    countBg: "bg-ink-secondary",
    collapsible: false,
  },
  review: { label: "รอ PM ตรวจ", spine: "bg-wait", countBg: "bg-wait", collapsible: false },
  done: { label: "เสร็จแล้ว", spine: "bg-done", countBg: "bg-done-strong", collapsible: true },
};

export function deriveActionBand(status: WorkPackageStatus): ActionBand {
  switch (status) {
    case "not_started":
    case "in_progress":
      return "todo";
    case "on_hold":
      return "held";
    case "pending_approval":
      return "review";
    case "complete":
      return "done";
    default:
      // Unknown future status — surface it where it can't be silently
      // lost: the actionable band.
      return "todo";
  }
}

/** What the row's next-action verb is asking the operator to do. The row
 *  maps kind → icon (assign = person, capture = camera, wait = paused). */
export type NextActionKind = "assign" | "capture" | "wait";

export interface NextAction {
  label: string;
  kind: NextActionKind;
}

/**
 * The precise next step for an actionable WP, factoring in whether a
 * contractor is assigned. A not_started WP with no owner needs assignment
 * BEFORE any photo makes sense — surfacing "take photos" there would be a
 * dead end. The row still links to the WP, where the action actually
 * happens; this just names it honestly at the list level.
 * Returns null for bands with no single row-level action (review, done).
 */
export function nextAction(status: WorkPackageStatus, hasContractor: boolean): NextAction | null {
  switch (status) {
    case "not_started":
      return hasContractor
        ? { label: "เริ่มถ่ายรูป เตรียมงาน", kind: "capture" }
        : { label: "มอบหมายผู้รับเหมา", kind: "assign" };
    case "in_progress":
      return { label: "ถ่ายรูป ความคืบหน้า", kind: "capture" };
    case "on_hold":
      return { label: "พักงานอยู่ — รอปลดล็อก", kind: "wait" };
    default:
      return null;
  }
}

/**
 * Map the manual priority flag to a sort rank — higher sorts first in the
 * ต้องทำ band (byPriorityRank desc). This is the L0 alignment rank; a later
 * critical-path engine can fold its own signal in on top.
 */
export function rankFromPriority(priority: WpPriority): number {
  switch (priority) {
    case "critical":
      return 2;
    case "urgent":
      return 1;
    default:
      return 0;
  }
}

export interface BandableWp {
  status: WorkPackageStatus;
  /** Universal cross-role rank (data layer supplies it). Higher = first. */
  priorityRank: number;
}

/**
 * Stable sort by priorityRank desc, preserving the incoming order
 * (already code-ascending from the page query) for ties. The lever that
 * aligns every role on the same highest-leverage work first.
 */
export function byPriorityRank<T extends BandableWp>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.priorityRank - a.item.priorityRank || a.index - b.index)
    .map(({ item }) => item);
}

/** Group an already-sorted list into bands, dropping empty bands. */
export function groupByActionBand<T extends BandableWp>(
  items: readonly T[],
): Array<{ band: ActionBand; items: T[] }> {
  const buckets = new Map<ActionBand, T[]>();
  for (const item of items) {
    const band = deriveActionBand(item.status);
    const bucket = buckets.get(band) ?? [];
    bucket.push(item);
    buckets.set(band, bucket);
  }
  return ACTION_BAND_ORDER.flatMap((band) => {
    const bucket = buckets.get(band);
    if (!bucket || bucket.length === 0) return [];
    return [{ band, items: byPriorityRank(bucket) }];
  });
}
