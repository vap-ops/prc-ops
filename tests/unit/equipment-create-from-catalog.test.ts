// Spec 385 U2 — createEquipmentFromCatalog: the server half of pick-from-ทะเบียน.
//
// What must hold and why:
//   * The instance INHERITS from the SKU — name (`<SKU> No.<n+1>` for unit
//     tracking), category, brand/model, tracking — server-derived, never trusted
//     from the client. The category-on-the-TYPE principle (spec 385 §1) only
//     holds if this layer enforces it.
//   * The rate copy runs through the EXISTING `set_equipment_daily_rate` DEFINER
//     RPC (audited, role-gated), with the SKU default read through the ADMIN
//     seam — `default_daily_rate` has no authenticated grant in any direction,
//     so an RLS read would silently see nothing (the worker_level_rates class).
//   * A rate-copy failure must NOT lose the item (the operator is standing at
//     the machine) — the action stays ok:true and raises rateWarning instead.
//   * A second BULK row for the same SKU is refused: two rows with the same name
//     is the duplicate disease the catalog exists to kill.
//   * The new-SKU escape writes the catalog row FIRST with created_by (its
//     INSERT policy pins created_by = auth.uid()), and a 23505 from the
//     active-name index comes back as a friendly "already in the catalog".

import { beforeEach, describe, expect, it, vi } from "vitest";

interface TableCall {
  table: string;
  payload: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  inserts: [] as TableCall[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  adminReads: 0,
  // .single() result for the existing-SKU catalog read.
  sku: null as Record<string, unknown> | null,
  // returned row for the new-SKU insert's .select().single().
  newSkuRow: null as Record<string, unknown> | null,
  newSkuError: null as unknown,
  itemInsertError: null as unknown,
  unitCount: 0,
  countError: null as unknown,
  rpcError: null as unknown,
  adminRate: null as number | null,
  adminReadError: null as unknown,
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
        select(_cols: string, _opts?: Record<string, unknown>) {
          return {
            eq(_col: string, _v: string) {
              const resolved =
                table === "equipment_catalog_items"
                  ? {
                      data: null,
                      error: null,
                      count: null,
                      single: async () =>
                        state.sku
                          ? { data: state.sku, error: null }
                          : { data: null, error: { code: "PGRST116" } },
                    }
                  : { count: state.unitCount, error: state.countError };
              return {
                ...resolved,
                then(onFulfilled: (v: unknown) => unknown) {
                  return Promise.resolve(resolved).then(onFulfilled);
                },
              };
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          state.inserts.push({ table, payload });
          const error =
            table === "equipment_catalog_items"
              ? state.newSkuError
              : table === "equipment_items"
                ? state.itemInsertError
                : null;
          return {
            select() {
              return {
                single: async () =>
                  error ? { data: null, error } : { data: state.newSkuRow, error: null },
              };
            },
            then(onFulfilled: (v: unknown) => unknown) {
              return Promise.resolve({ error }).then(onFulfilled);
            },
          };
        },
        rpc: undefined,
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcs.push({ fn, args });
      return Promise.resolve({ error: state.rpcError });
    },
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => {
                  state.adminReads += 1;
                  return state.adminReadError
                    ? { data: null, error: state.adminReadError }
                    : { data: { default_daily_rate: state.adminRate }, error: null };
                },
              };
            },
          };
        },
      };
    },
  }),
}));

import { createEquipmentFromCatalog } from "@/app/equipment/actions";

const ITEM_ID = "11111111-2222-4333-8444-555555555555";
const SKU_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OWNER_ID = "a43fdea5-4e94-4065-9ac7-182da0692348";
const CAT_ID = "ac49d5cf-06f7-4e43-963d-58d36763f429";

const baseInput = {
  id: ITEM_ID,
  photos: [],
  ownerId: OWNER_ID,
  assetTag: "",
  quantity: null,
  status: "available",
};

beforeEach(() => {
  state.inserts = [];
  state.rpcs = [];
  state.adminReads = 0;
  state.sku = {
    id: SKU_ID,
    name: "เครื่องตบดิน",
    category_id: CAT_ID,
    brand: "MARTON",
    model: null,
    default_tracking: "unit",
    is_active: true,
  };
  state.newSkuRow = null;
  state.newSkuError = null;
  state.itemInsertError = null;
  state.unitCount = 0;
  state.countError = null;
  state.rpcError = null;
  state.adminRate = 300;
  state.adminReadError = null;
});

describe("createEquipmentFromCatalog — existing SKU", () => {
  it("derives name, category, brand/model and tracking from the SKU and pins the FK", async () => {
    state.unitCount = 2;

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result.ok).toBe(true);
    const item = state.inserts.find((c) => c.table === "equipment_items");
    expect(item?.payload).toMatchObject({
      id: ITEM_ID,
      name: "เครื่องตบดิน No.3",
      category_id: CAT_ID,
      owner_id: OWNER_ID,
      supplier_id: OWNER_ID,
      tracking: "unit",
      brand: "MARTON",
      model: null,
      equipment_catalog_item_id: SKU_ID,
      created_by: "u1",
    });
  });

  it("copies the SKU default rate through the audited RPC (admin read, RPC write)", async () => {
    await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(state.adminReads).toBe(1);
    expect(state.rpcs).toEqual([
      { fn: "set_equipment_daily_rate", args: { p_id: ITEM_ID, p_rate: 300 } },
    ]);
  });

  it("skips the rate RPC when the SKU has no default", async () => {
    state.adminRate = null;

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result).toEqual({ ok: true });
    expect(state.rpcs).toEqual([]);
  });

  it("raises rateWarning when the ADMIN READ fails — a broken read must not pass as 'no default'", async () => {
    state.adminReadError = { code: "XX000" };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result).toEqual({ ok: true, rateWarning: true });
    expect(state.rpcs).toEqual([]);
  });

  it("refuses when the instance COUNT read fails — existing=0 would collide No.1 and bypass the bulk rule", async () => {
    state.countError = { code: "XX000" };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result.ok).toBe(false);
    expect(state.inserts).toEqual([]);
  });

  it("maps an asset-tag 23505 to a named, non-retry message (honest-copy class)", async () => {
    state.itemInsertError = { code: "23505" };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      assetTag: "GEN-001",
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("รหัสครุภัณฑ์");
      expect(result.error).not.toContain("ลองใหม่");
    }
  });

  it("refuses a crafted source.kind instead of crashing", async () => {
    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "evil" } as unknown as Parameters<
        typeof createEquipmentFromCatalog
      >[0]["source"],
    });

    expect(result.ok).toBe(false);
    expect(state.inserts).toEqual([]);
  });

  it("keeps the item and raises rateWarning when the rate copy fails — never lose the row", async () => {
    state.rpcError = { code: "P0001" };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result).toEqual({ ok: true, rateWarning: true });
    expect(state.inserts.some((c) => c.table === "equipment_items")).toBe(true);
  });

  it("refuses an inactive SKU before writing anything", async () => {
    state.sku = { ...state.sku!, is_active: false };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result.ok).toBe(false);
    expect(state.inserts).toEqual([]);
  });

  it("refuses a second BULK row for the same SKU and points at the existing row", async () => {
    state.sku = { ...state.sku!, name: "สายยางวัดระดับน้ำ", default_tracking: "bulk" };
    state.unitCount = 1;

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      quantity: 3,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("แก้ไขจำนวน");
    expect(state.inserts).toEqual([]);
  });

  it("creates a fresh BULK row under the SKU's own name with the quantity", async () => {
    state.sku = { ...state.sku!, name: "สายยางวัดระดับน้ำ", default_tracking: "bulk" };
    state.unitCount = 0;

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      quantity: 3,
      source: { kind: "existing", catalogItemId: SKU_ID },
    });

    expect(result.ok).toBe(true);
    const item = state.inserts.find((c) => c.table === "equipment_items");
    expect(item?.payload).toMatchObject({
      name: "สายยางวัดระดับน้ำ",
      tracking: "bulk",
      quantity: 3,
      asset_tag: null,
    });
  });
});

describe("createEquipmentFromCatalog — the new-SKU escape", () => {
  it("creates the catalog row FIRST (created_by pinned) then the instance under it", async () => {
    state.newSkuRow = {
      id: SKU_ID,
      name: "เครื่องปั่นไฟ",
      category_id: CAT_ID,
      brand: null,
      model: null,
      default_tracking: "unit",
      is_active: true,
    };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "new", name: "  เครื่องปั่นไฟ ", categoryId: CAT_ID, tracking: "unit" },
    });

    expect(result.ok).toBe(true);
    expect(state.inserts.map((c) => c.table)).toEqual([
      "equipment_catalog_items",
      "equipment_items",
    ]);
    expect(state.inserts[0]?.payload).toMatchObject({
      name: "เครื่องปั่นไฟ",
      category_id: CAT_ID,
      default_tracking: "unit",
      created_by: "u1",
    });
    expect(state.inserts[1]?.payload).toMatchObject({
      name: "เครื่องปั่นไฟ No.1",
      equipment_catalog_item_id: SKU_ID,
    });
  });

  it("maps the active-name 23505 to a friendly 'already in the catalog' and writes no instance", async () => {
    state.newSkuError = { code: "23505" };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "new", name: "เครื่องตบดิน", categoryId: CAT_ID, tracking: "unit" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("มีชื่อนี้ในทะเบียนอยู่แล้ว — เลือกจากทะเบียนได้เลย");
    }
    expect(state.inserts.map((c) => c.table)).toEqual(["equipment_catalog_items"]);
  });

  it("registers a BULK SKU through the escape and creates its row with the quantity", async () => {
    state.newSkuRow = {
      id: SKU_ID,
      name: "สายไฟพ่วงสนาม",
      category_id: CAT_ID,
      brand: null,
      model: null,
      default_tracking: "bulk",
      is_active: true,
    };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      quantity: 4,
      source: { kind: "new", name: "สายไฟพ่วงสนาม", categoryId: CAT_ID, tracking: "bulk" },
    });

    expect(result.ok).toBe(true);
    expect(state.inserts[0]?.payload).toMatchObject({ default_tracking: "bulk" });
    expect(state.inserts[1]?.payload).toMatchObject({
      name: "สายไฟพ่วงสนาม",
      tracking: "bulk",
      quantity: 4,
    });
  });

  it("refuses an invalid tracking string on the escape — the one client-trusted field", async () => {
    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "new", name: "ของใหม่", categoryId: CAT_ID, tracking: "weird" },
    });

    expect(result.ok).toBe(false);
    expect(state.inserts).toEqual([]);
  });

  it("a failed instance insert on the escape path names the state honestly — the SKU is already registered", async () => {
    state.newSkuRow = {
      id: SKU_ID,
      name: "เครื่องปั่นไฟ",
      category_id: CAT_ID,
      brand: null,
      model: null,
      default_tracking: "unit",
      is_active: true,
    };
    state.itemInsertError = { code: "42501" };

    const result = await createEquipmentFromCatalog({
      ...baseInput,
      source: { kind: "new", name: "เครื่องปั่นไฟ", categoryId: CAT_ID, tracking: "unit" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("เพิ่มรายการเข้าทะเบียนแล้ว");
      expect(result.error).not.toContain("ลองใหม่");
    }
  });
});
