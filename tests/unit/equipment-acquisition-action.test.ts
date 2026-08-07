// Spec 367 §10.4 — setEquipmentAcquisition, the app half of the money write path.
//
// `acquisition_cost` / `acquired_at` carry NO authenticated grant in either
// direction, so this action exists only to reach the DEFINER RPC where the gate
// and the audit row live. What must hold:
//   * it goes through `set_equipment_acquisition`, never a table UPDATE — an RLS
//     write would 42501 and the audit trail would not exist;
//   * a blank cost or date is sent as NULL, which CLEARS. One meaning per
//     argument: "leave unchanged" would be a second reading of the same input;
//   * client-side validation refuses the two cases the RPC raises P0001 on, so
//     the common mistakes get a Thai sentence instead of a generic failure;
//   * a refusal is surfaced, never swallowed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  rpcError: null as unknown,
  tableWrites: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "procurement_manager" })),
}));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    from(table: string) {
      // Any table write here is a bug: the columns are walled.
      state.tableWrites.push(table);
      return {
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        insert: () => Promise.resolve({ error: null }),
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcs.push({ fn, args });
      return Promise.resolve({ error: state.rpcError });
    },
  }),
}));

import { setEquipmentAcquisition } from "@/app/equipment/actions";

const ITEM = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  state.rpcs = [];
  state.rpcError = null;
  state.tableWrites = [];
});

describe("setEquipmentAcquisition", () => {
  it("writes through the DEFINER RPC and never touches the table directly", async () => {
    const result = await setEquipmentAcquisition({
      id: ITEM,
      cost: "12500.50",
      acquiredAt: "2025-03-04",
    });

    expect(result).toEqual({ ok: true });
    expect(state.rpcs).toEqual([
      {
        fn: "set_equipment_acquisition",
        args: { p_id: ITEM, p_cost: 12500.5, p_acquired_at: "2025-03-04" },
      },
    ]);
    expect(state.tableWrites).toEqual([]);
  });

  // Both value params carry `default null` in SQL, so OMITTING one is how the
  // clear is expressed — and it is the only shape the generated Args type allows
  // (an optional param is `p_cost?: number`, never `number | null`). The 1-arg
  // clearing form is pinned in pgTAP 367c; this pins the app end of the same rule.
  it("omits a blank field, which CLEARS via the SQL default — not 'leave unchanged'", async () => {
    await setEquipmentAcquisition({ id: ITEM, cost: "", acquiredAt: "" });

    expect(state.rpcs[0]?.args).toEqual({ p_id: ITEM });
  });

  it("omits only the blank one when the other is filled", async () => {
    await setEquipmentAcquisition({ id: ITEM, cost: "500", acquiredAt: "" });

    expect(state.rpcs[0]?.args).toEqual({ p_id: ITEM, p_cost: 500 });
  });

  it("refuses a negative cost before the round trip", async () => {
    const result = await setEquipmentAcquisition({ id: ITEM, cost: "-5", acquiredAt: "" });

    expect(result.ok).toBe(false);
    expect(state.rpcs).toEqual([]);
  });

  it("refuses a non-numeric cost before the round trip", async () => {
    const result = await setEquipmentAcquisition({ id: ITEM, cost: "หมื่นห้า", acquiredAt: "" });

    expect(result.ok).toBe(false);
    expect(state.rpcs).toEqual([]);
  });

  it("refuses a malformed date rather than sending it to the DB", async () => {
    const result = await setEquipmentAcquisition({ id: ITEM, cost: "", acquiredAt: "04/03/2025" });

    expect(result.ok).toBe(false);
    expect(state.rpcs).toEqual([]);
  });

  it("refuses a crafted item id", async () => {
    const result = await setEquipmentAcquisition({ id: "not-a-uuid", cost: "1", acquiredAt: "" });

    expect(result.ok).toBe(false);
    expect(state.rpcs).toEqual([]);
  });

  it("surfaces an RPC refusal instead of reporting success", async () => {
    state.rpcError = { code: "42501" };

    const result = await setEquipmentAcquisition({ id: ITEM, cost: "1", acquiredAt: "" });

    expect(result.ok).toBe(false);
  });
});
