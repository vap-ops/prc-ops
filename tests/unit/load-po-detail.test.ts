// Spec 148 U1 — the PO-detail loader batches its independent queries. RED first:
// concurrency (max in-flight >= 3: po ∥ members ∥ deliveries; serial peaks at 1)
// + shape. The admin client (per-line amount, back-office money) is stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const AMOUNTS = [{ id: "pr1", amount: 500 }];
// Spec 260 — the loader also reads the PO's charges via the admin client
// (.select().eq().order()); the amounts read is .select().in(). One stub covers both.
const CHARGES = [{ id: "c1", charge_type: "transport", amount: 100, note: null }];
vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        in: async () => ({ data: AMOUNTS, error: null }),
        eq: () => ({ order: async () => ({ data: CHARGES, error: null }) }),
      }),
    }),
  }),
}));

import { loadPurchaseOrderDetail } from "@/lib/purchasing/load-po-detail";

let inFlight = 0;
let maxInFlight = 0;

const PO = {
  id: "po1",
  po_number: 7,
  supplier: "ผู้ขาย",
  supplier_id: "s1",
  eta: null,
  ordered_at: null,
  notes: null,
};
const MEMBERS = [
  {
    id: "pr1",
    pr_number: 1,
    item_description: "ปูน",
    quantity: 1,
    unit: "ถุง",
    status: "purchased",
    priority: "normal",
    work_package_id: "w1",
    delivery_id: "del1",
    delivered_at: null,
  },
];
const DELIVERIES = [{ id: "del1", eta: null, created_at: "2026-06-01" }];
const WPS = [{ id: "w1", code: "WP-01", name: "งาน", project_id: "p1" }];

const SINGLE: Record<string, unknown> = { purchase_orders: PO };
const LIST: Record<string, unknown[]> = {
  purchase_requests: MEMBERS,
  purchase_order_deliveries: DELIVERIES,
  work_packages: WPS,
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

describe("loadPurchaseOrderDetail", () => {
  it("runs po + members + deliveries concurrently", async () => {
    await loadPurchaseOrderDetail(supabase, "po1", { isBackOffice: true });
    expect(maxInFlight).toBeGreaterThanOrEqual(3);
  });

  it("assembles the correct shape", async () => {
    const data = await loadPurchaseOrderDetail(supabase, "po1", { isBackOffice: true });
    expect(data.po?.po_number).toBe(7);
    expect(data.members).toEqual(MEMBERS);
    expect(data.deliveryRows).toEqual(DELIVERIES);
    expect(data.wpById.get("w1")?.code).toBe("WP-01");
    expect(data.amountById.get("pr1")).toBe(500);
    // Spec 260 — the charges load (money, back-office gated).
    expect(data.charges).toEqual(CHARGES);
  });

  it("skips amounts and charges for non-back-office", async () => {
    const data = await loadPurchaseOrderDetail(supabase, "po1", { isBackOffice: false });
    expect(data.amountById.size).toBe(0);
    expect(data.charges).toEqual([]);
  });
});
