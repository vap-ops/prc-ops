// Spec 385 U3a — the ทะเบียน curation actions. All three are plain RLS writes on
// columns `authenticated` holds UPDATE/INSERT grants for (name, category_id,
// brand, model, default_tracking, is_active — verified live at U1); the
// back-office policies are the guard, requireRole is defense-in-depth. Money
// (default_daily_rate) is NOT touchable here — no grant in any direction; the
// rate editor is U3b's DEFINER RPC.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  updates: [] as { table: string; payload: Record<string, unknown>; id: string }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  insertError: null as unknown,
  updateError: null as unknown,
  rpcError: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "procurement_manager" })),
}));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcs.push({ fn, args });
      return Promise.resolve({ error: state.rpcError });
    },
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          state.inserts.push({ table, payload });
          return Promise.resolve({ error: state.insertError });
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              state.updates.push({ table, payload, id });
              return Promise.resolve({ error: state.updateError });
            },
          };
        },
      };
    },
  }),
}));

import {
  createEquipmentCatalogItem,
  updateEquipmentCatalogItem,
  setEquipmentCatalogItemActive,
  setEquipmentCatalogDefaultRate,
} from "@/app/equipment/actions";

const CAT_ID = "ac49d5cf-06f7-4e43-963d-58d36763f429";
const SKU_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeEach(() => {
  state.inserts = [];
  state.updates = [];
  state.rpcs = [];
  state.insertError = null;
  state.updateError = null;
  state.rpcError = null;
});

describe("createEquipmentCatalogItem", () => {
  it("registers a SKU with trimmed name, category, tracking and the created_by pin", async () => {
    const result = await createEquipmentCatalogItem({
      name: "  เครื่องปั่นไฟ 5kVA ",
      categoryId: CAT_ID,
      tracking: "unit",
    });

    expect(result).toEqual({ ok: true });
    expect(state.inserts).toEqual([
      {
        table: "equipment_catalog_items",
        payload: {
          name: "เครื่องปั่นไฟ 5kVA",
          category_id: CAT_ID,
          default_tracking: "unit",
          created_by: "u1",
        },
      },
    ]);
  });

  it("maps the active-name 23505 to the named non-retry message", async () => {
    state.insertError = { code: "23505" };
    const result = await createEquipmentCatalogItem({
      name: "เครื่องตบดิน",
      categoryId: CAT_ID,
      tracking: "unit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("มีชื่อนี้ในทะเบียน");
      expect(result.error).not.toContain("ลองใหม่");
    }
  });

  it("refuses blank name, bad category and bad tracking before writing", async () => {
    expect(
      (await createEquipmentCatalogItem({ name: "  ", categoryId: CAT_ID, tracking: "unit" })).ok,
    ).toBe(false);
    expect(
      (await createEquipmentCatalogItem({ name: "x", categoryId: "nope", tracking: "unit" })).ok,
    ).toBe(false);
    expect(
      (await createEquipmentCatalogItem({ name: "x", categoryId: CAT_ID, tracking: "weird" })).ok,
    ).toBe(false);
    expect(state.inserts).toEqual([]);
  });
});

describe("updateEquipmentCatalogItem", () => {
  it("updates name/category/brand/model on the row — blank brand/model become null", async () => {
    const result = await updateEquipmentCatalogItem({
      id: SKU_ID,
      name: " เครื่องตบดิน ",
      categoryId: CAT_ID,
      brand: "  ",
      model: " MT-90 ",
    });

    expect(result).toEqual({ ok: true });
    expect(state.updates).toEqual([
      {
        table: "equipment_catalog_items",
        id: SKU_ID,
        payload: { name: "เครื่องตบดิน", category_id: CAT_ID, brand: null, model: "MT-90" },
      },
    ]);
  });

  it("maps a rename collision 23505 to the named message", async () => {
    state.updateError = { code: "23505" };
    const result = await updateEquipmentCatalogItem({
      id: SKU_ID,
      name: "เครื่องเชื่อมไฟฟ้า",
      categoryId: CAT_ID,
      brand: "",
      model: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("มีชื่อนี้ในทะเบียน");
  });

  it("refuses a bad id before writing", async () => {
    expect(
      (
        await updateEquipmentCatalogItem({
          id: "nope",
          name: "x",
          categoryId: CAT_ID,
          brand: "",
          model: "",
        })
      ).ok,
    ).toBe(false);
    expect(state.updates).toEqual([]);
  });
});

describe("setEquipmentCatalogItemActive", () => {
  it("flips is_active", async () => {
    const result = await setEquipmentCatalogItemActive({ id: SKU_ID, active: false });
    expect(result).toEqual({ ok: true });
    expect(state.updates).toEqual([
      { table: "equipment_catalog_items", id: SKU_ID, payload: { is_active: false } },
    ]);
  });

  it("a REACTIVATE that collides with an active same-name SKU gets the named 23505 message", async () => {
    state.updateError = { code: "23505" };
    const result = await setEquipmentCatalogItemActive({ id: SKU_ID, active: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("มีชื่อนี้ในทะเบียน");
  });
});

// Spec 385 U3b — MONEY goes through the DEFINER RPC only: default_daily_rate
// has no authenticated grant, so a table write here would silently no-op.
describe("setEquipmentCatalogDefaultRate", () => {
  it("writes through the RPC with the validated rate — never a table update", async () => {
    const result = await setEquipmentCatalogDefaultRate({ id: SKU_ID, rate: 250 });
    expect(result).toEqual({ ok: true });
    expect(state.rpcs).toEqual([
      { fn: "set_equipment_catalog_default_rate", args: { p_id: SKU_ID, p_rate: 250 } },
    ]);
    expect(state.updates).toEqual([]);
  });

  it("maps 42501 and P0001 to named messages", async () => {
    state.rpcError = { code: "42501" };
    const denied = await setEquipmentCatalogDefaultRate({ id: SKU_ID, rate: 100 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toContain("สิทธิ์");

    state.rpcError = { code: "P0001" };
    const bad = await setEquipmentCatalogDefaultRate({ id: SKU_ID, rate: 100 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("ทะเบียน");
  });

  it("refuses a bad id or negative rate before calling the RPC", async () => {
    expect((await setEquipmentCatalogDefaultRate({ id: "nope", rate: 100 })).ok).toBe(false);
    expect((await setEquipmentCatalogDefaultRate({ id: SKU_ID, rate: -5 })).ok).toBe(false);
    expect(state.rpcs).toEqual([]);
  });
});
