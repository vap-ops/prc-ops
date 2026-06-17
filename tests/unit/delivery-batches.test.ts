// Spec 134 U7 — groupDeliveryBatches: fork a PO's lines into the delivery batches
// that arrived (grouped by delivery_batch_id, falling back to delivered_at) + the
// pending remainder. Drives the PO-detail delivery breakdown.

import { describe, expect, it } from "vitest";
import { groupDeliveryBatches } from "@/lib/purchasing/delivery-batches";

const line = (over: {
  status: Parameters<typeof groupDeliveryBatches>[0][number]["status"];
  delivered_at?: string | null;
  delivery_batch_id?: string | null;
  eta?: string | null;
}) => ({
  status: over.status,
  delivered_at: over.delivered_at ?? null,
  delivery_batch_id: over.delivery_batch_id ?? null,
  eta: over.eta ?? null,
});

describe("groupDeliveryBatches", () => {
  it("groups one fully-received delivery into a single batch, no pending", () => {
    const r = groupDeliveryBatches([
      line({ status: "delivered", delivery_batch_id: "b1", delivered_at: "2026-06-12T03:00:00Z" }),
      line({ status: "delivered", delivery_batch_id: "b1", delivered_at: "2026-06-12T03:00:00Z" }),
    ]);
    expect(r.batches).toEqual([{ key: "b1", count: 2, receivedAt: "2026-06-12T03:00:00Z" }]);
    expect(r.pending).toBeNull();
  });

  it("splits two received batches, ordered by receipt date", () => {
    const r = groupDeliveryBatches([
      line({ status: "delivered", delivery_batch_id: "b2", delivered_at: "2026-06-15T03:00:00Z" }),
      line({ status: "delivered", delivery_batch_id: "b1", delivered_at: "2026-06-12T03:00:00Z" }),
      line({ status: "delivered", delivery_batch_id: "b1", delivered_at: "2026-06-12T03:00:00Z" }),
    ]);
    expect(r.batches.map((b) => [b.key, b.count])).toEqual([
      ["b1", 2],
      ["b2", 1],
    ]);
    expect(r.pending).toBeNull();
  });

  it("reports the pending remainder with the earliest eta", () => {
    const r = groupDeliveryBatches([
      line({ status: "delivered", delivery_batch_id: "b1", delivered_at: "2026-06-12T03:00:00Z" }),
      line({ status: "on_route", eta: "2026-06-20" }),
      line({ status: "purchased", eta: "2026-06-18" }),
    ]);
    expect(r.batches).toHaveLength(1);
    expect(r.pending).toEqual({ count: 2, earliestEta: "2026-06-18" });
  });

  it("falls back to delivered_at grouping when batch id is absent", () => {
    const r = groupDeliveryBatches([
      line({ status: "delivered", delivered_at: "2026-06-12T03:00:00Z" }),
      line({ status: "delivered", delivered_at: "2026-06-14T03:00:00Z" }),
    ]);
    expect(r.batches).toHaveLength(2);
  });

  it("excludes rejected/cancelled and reports null pending eta when none set", () => {
    const r = groupDeliveryBatches([
      line({ status: "delivered", delivery_batch_id: "b1", delivered_at: "2026-06-12T03:00:00Z" }),
      line({ status: "on_route" }),
      line({ status: "rejected" }),
      line({ status: "cancelled" }),
    ]);
    expect(r.batches).toHaveLength(1);
    expect(r.pending).toEqual({ count: 1, earliestEta: null });
  });

  it("is empty when nothing is delivered or pending", () => {
    expect(groupDeliveryBatches([])).toEqual({ batches: [], pending: null });
  });
});
