// Spec 367 §10.4 (second half) — importEquipmentCsv routes the money cells.
//
// The parser now CARRIES cost/date/rate; if the action did not write them the
// operator would fill 64 prices, see "64 updated", and lose the numbers — the
// exact silent-success the old refusal existed to prevent. So the two halves
// ship together.
//
// The money never rides the row UPDATE: those columns have no authenticated
// grant, so each figure goes to its own SECURITY DEFINER RPC.
//
// ⚠️ The two RPCs disagree about blank, and the action is where that is resolved:
//   * `set_equipment_acquisition` accepts null ⇒ a blank cost/date CLEARS.
//   * `set_equipment_daily_rate` refuses null ⇒ a blank rate is LEFT ALONE.
// Both are compared against the CURRENT value so an unchanged column writes no
// RPC call and no audit row — a re-imported export must not manufacture history.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  updates: [] as Record<string, unknown>[],
  /** Current money values, as the admin seam would read them. */
  current: [] as Record<string, unknown>[],
  cats: [] as Record<string, unknown>[],
  owners: [] as Record<string, unknown>[],
  items: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "procurement_manager" })),
}));

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const data =
        table === "equipment_categories"
          ? state.cats
          : table === "equipment_owners"
            ? state.owners
            : table === "equipment_items"
              ? state.items
              : [];
      return {
        select: () => Promise.resolve({ data, error: null }),
        update(payload: Record<string, unknown>) {
          state.updates.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcs.push({ fn, args });
      return Promise.resolve({ error: null });
    },
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: () => ({ select: () => Promise.resolve({ data: state.current, error: null }) }),
  }),
}));

import { importEquipmentCsv } from "@/app/equipment/actions";

const ID = "11111111-2222-4333-8444-555555555555";
const HEAD =
  "รหัสอ้างอิง\tชื่อ\tหมวดหมู่\tการติดตาม\tจำนวน\tสถานะ\tเจ้าของ\tวันที่ได้มา\tราคาทุน\tค่าเช่า/วัน";
const row = (acquiredAt: string, cost: string, rate: string) =>
  `${ID}\tสว่าน No.1\tหมวด\tรายชิ้น (มีรหัส)\t\tพร้อมใช้งาน\tPRI\t${acquiredAt}\t${cost}\t${rate}`;
const file = (acquiredAt = "", cost = "", rate = "") => `${HEAD}\n${row(acquiredAt, cost, rate)}`;

beforeEach(() => {
  state.rpcs = [];
  state.updates = [];
  state.cats = [{ id: "c1", name: "หมวด" }];
  state.owners = [{ id: "o1", name: "PRI" }];
  state.items = [{ id: ID }];
  state.current = [{ id: ID, acquisition_cost: null, acquired_at: null, daily_rate: null }];
});

describe("importEquipmentCsv — money routing", () => {
  it("writes a filled cost and date through the acquisition RPC, not the row UPDATE", async () => {
    const result = await importEquipmentCsv(file("2025-03-04", "48000", ""));

    expect(result.ok).toBe(true);
    expect(state.rpcs).toEqual([
      {
        fn: "set_equipment_acquisition",
        args: { p_id: ID, p_cost: 48000, p_acquired_at: "2025-03-04" },
      },
    ]);
    for (const payload of state.updates) {
      expect(payload).not.toHaveProperty("acquisition_cost");
      expect(payload).not.toHaveProperty("acquired_at");
      expect(payload).not.toHaveProperty("daily_rate");
    }
  });

  it("writes a filled rate through its own RPC", async () => {
    const result = await importEquipmentCsv(file("", "", "350"));

    expect(result.ok).toBe(true);
    expect(state.rpcs).toEqual([
      { fn: "set_equipment_daily_rate", args: { p_id: ID, p_rate: 350 } },
    ]);
  });

  it("calls NOTHING when the money columns match what is already stored", async () => {
    // A re-imported export is the common case; it must not manufacture audit rows.
    state.current = [
      { id: ID, acquisition_cost: 48000, acquired_at: "2025-03-04", daily_rate: 350 },
    ];

    await importEquipmentCsv(file("2025-03-04", "48000", "350"));

    expect(state.rpcs).toEqual([]);
  });

  it("CLEARS the acquisition figures when their cells are blanked", async () => {
    state.current = [
      { id: ID, acquisition_cost: 48000, acquired_at: "2025-03-04", daily_rate: null },
    ];

    await importEquipmentCsv(file("", "", ""));

    expect(state.rpcs).toEqual([{ fn: "set_equipment_acquisition", args: { p_id: ID } }]);
  });

  it("LEAVES a stored rate alone when its cell is blank — that RPC cannot clear", async () => {
    state.current = [{ id: ID, acquisition_cost: null, acquired_at: null, daily_rate: 350 }];

    await importEquipmentCsv(file("", "", ""));

    expect(state.rpcs.filter((r) => r.fn === "set_equipment_daily_rate")).toEqual([]);
  });

  it("reports how many rows had a money change, separately from the row updates", async () => {
    const result = await importEquipmentCsv(file("2025-03-04", "48000", "350"));

    expect(result.updates).toBe(1);
    expect(result.moneyUpdates).toBe(1);
  });

  it("a dry run writes nothing at all, RPCs included", async () => {
    const result = await importEquipmentCsv(file("2025-03-04", "48000", "350"), { dryRun: true });

    expect(result.ok).toBe(true);
    expect(state.rpcs).toEqual([]);
    expect(state.updates).toEqual([]);
  });
});
