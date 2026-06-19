// Spec 148 U2 — the delivery-detail loader batches its independent queries. RED
// first: concurrency (max in-flight >= 5: po ∥ delivery ∥ members ∥ deliveryRows
// ∥ proofRows; serial peaks at 1) + shape. mintSignedUrls is stubbed; the pure
// view/group helpers run for real.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/storage/signed-urls", () => ({
  mintSignedUrls: vi.fn(async () => new Map<string, string>([["pf1", "signed-pf1"]])),
}));

import { loadDeliveryDetail } from "@/lib/purchasing/load-delivery-detail";

let inFlight = 0;
let maxInFlight = 0;

const PO = { id: "po1", po_number: 9, supplier: "X" };
const DELIVERY = { id: "del1", eta: null, note: null, cost: 100, created_at: "2026-06-01" };
const MEMBERS = [
  {
    id: "pr1",
    pr_number: 1,
    item_description: "ปูน",
    quantity: 1,
    unit: "ถุง",
    status: "purchased",
    work_package_id: "w1",
    delivery_id: "del1",
    delivered_at: null,
  },
];
const DELIVERY_ROWS = [{ id: "del1", eta: null, created_at: "2026-06-01" }];
const PROOF = [{ id: "pf1", kind: "image", storage_path: "p", delivery_id: "del1" }];

const SINGLE: Record<string, unknown> = {
  purchase_orders: PO,
  purchase_order_deliveries: DELIVERY, // the by-id maybeSingle read
};
const LIST: Record<string, unknown[]> = {
  purchase_requests: MEMBERS,
  purchase_order_deliveries: DELIVERY_ROWS, // the by-PO list read
  purchase_order_attachments_current: PROOF,
};

function makeQuery(table: string) {
  const q: Record<string, unknown> = { __single: false };
  for (const m of ["select", "eq", "neq", "in", "order", "limit"]) {
    q[m] = () => q;
  }
  q.maybeSingle = () => {
    q.__single = true;
    return q;
  };
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return new Promise((r) => setTimeout(r, 5))
      .then(() => {
        inFlight--;
        return { data: q.__single ? SINGLE[table] : (LIST[table] ?? []), error: null };
      })
      .then(resolve, reject);
  };
  return q;
}

const supabase = { from: (table: string) => makeQuery(table) } as never;

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
});

describe("loadDeliveryDetail", () => {
  it("runs all five reads concurrently", async () => {
    await loadDeliveryDetail(supabase, "po1", "del1");
    expect(maxInFlight).toBeGreaterThanOrEqual(5);
  });

  it("assembles the correct shape", async () => {
    const data = await loadDeliveryDetail(supabase, "po1", "del1");
    expect(data.po?.po_number).toBe(9);
    expect(data.delivery?.cost).toBe(100);
    expect(data.members).toEqual(MEMBERS);
    expect(data.deliveries.length).toBe(1);
    expect(data.deliveries[0]?.id).toBe("del1");
    expect(data.proofDocs.length).toBe(1);
    expect(data.proofUrls.get("pf1")).toBe("signed-pf1");
  });
});
