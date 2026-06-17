// Spec 134 U7 — fork a PO's member lines into delivery batches. A partial delivery
// makes the PO a fork-join: lines received together (one delivery_batch_id, stamped
// by receive_po_lines / the split RPC) form a batch; the still-in-transit lines are
// the pending remainder. Pure (no DB / no React) → unit-tested. Drives the PO-detail
// delivery breakdown; rejected/cancelled lines are excluded (ADR 0044 §5).

import type { PurchaseRequestStatus } from "@/lib/db/enums";

export interface DeliveryBatchLine {
  status: PurchaseRequestStatus;
  delivered_at: string | null;
  delivery_batch_id: string | null;
  eta: string | null;
}

export interface DeliveryBatch {
  /** delivery_batch_id, or the delivered_at fallback when a line carries no id. */
  key: string;
  count: number;
  receivedAt: string;
}

export interface DeliveryBreakdown {
  /** Received batches, oldest receipt first. */
  batches: DeliveryBatch[];
  /** In-transit remainder (purchased/on_route), or null when nothing is pending. */
  pending: { count: number; earliestEta: string | null } | null;
}

export function groupDeliveryBatches(lines: ReadonlyArray<DeliveryBatchLine>): DeliveryBreakdown {
  const active = lines.filter((l) => l.status !== "rejected" && l.status !== "cancelled");

  // Received batches: group delivered lines by id (fallback: delivered_at).
  const order: string[] = [];
  const byKey = new Map<string, { count: number; receivedAt: string }>();
  for (const l of active) {
    if (l.status !== "delivered") continue;
    const key = l.delivery_batch_id ?? l.delivered_at ?? "unknown";
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, { count: 1, receivedAt: l.delivered_at ?? "" });
      order.push(key);
    }
  }
  const batches = order
    .map((key) => ({ key, count: byKey.get(key)!.count, receivedAt: byKey.get(key)!.receivedAt }))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  // Pending remainder: lines still on order (not delivered).
  const pendingLines = active.filter((l) => l.status === "purchased" || l.status === "on_route");
  const etas = pendingLines
    .map((l) => l.eta)
    .filter((e): e is string => e !== null)
    .sort((a, b) => a.localeCompare(b));
  const pending =
    pendingLines.length > 0 ? { count: pendingLines.length, earliestEta: etas[0] ?? null } : null;

  return { batches, pending };
}
