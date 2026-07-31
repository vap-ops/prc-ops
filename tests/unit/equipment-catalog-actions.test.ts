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
  insertError: null as unknown,
  updateError: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "procurement_manager" })),
}));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
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
} from "@/app/equipment/actions";

const CAT_ID = "ac49d5cf-06f7-4e43-963d-58d36763f429";
const SKU_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeEach(() => {
  state.inserts = [];
  state.updates = [];
  state.insertError = null;
  state.updateError = null;
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
