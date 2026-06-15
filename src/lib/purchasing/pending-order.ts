// Spec 36 (extracts the spec-19 §4 / spec-16 A2 ordering from
// /requests/page.tsx into a pure, pinned comparator): pending requests
// rank by priority band (critical → urgent → normal), oldest-first
// within a band — queue wait time is the tiebreaker the back office
// actually works by.

import type { Database } from "@/lib/db/database.types";

type PurchaseRequestPriority = Database["public"]["Enums"]["purchase_request_priority"];

// Exported (spec 110) so the worklist priority sort reuses the one rank.
export const PR_PRIORITY_RANK: Record<PurchaseRequestPriority, number> = {
  critical: 0,
  urgent: 1,
  normal: 2,
};

export function comparePendingRequests(
  a: { priority: PurchaseRequestPriority; requested_at: string },
  b: { priority: PurchaseRequestPriority; requested_at: string },
): number {
  return (
    PR_PRIORITY_RANK[a.priority] - PR_PRIORITY_RANK[b.priority] ||
    a.requested_at.localeCompare(b.requested_at)
  );
}
