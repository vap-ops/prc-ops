// Spec 367 §13 — bulkAddEquipmentFromCatalog: the server half of the bulk paste.
//
// What must hold and why:
//   * ตรวจสอบ (dry run) writes NOTHING and reports each line's effect in words.
//     `จำนวน` means two different things by tracking, so the preview is the only
//     place the operator learns which one their file asked for.
//   * A unit line writes N rows, named `<SKU> No.<n+1>` … from the LIVE count —
//     the same derivation the add sheet uses, never trusted from the file.
//   * Every created row also gets its initial `equipment_movements` event. Without
//     it the bulk path re-creates the `—` defect PR #1024 just closed, 68 times
//     in one press.
//   * A parse error writes nothing at all.
//   * A mid-commit failure reports how many landed and NAMES the SKU it stopped
//     on — the transport cannot roll back, so claiming it did would be a lie.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface TableCall {
  table: string;
  payload: Record<string, unknown> | Record<string, unknown>[];
}

const state = vi.hoisted(() => ({
  inserts: [] as TableCall[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  skus: [] as Record<string, unknown>[],
  items: [] as Record<string, unknown>[],
  owners: [] as Record<string, unknown>[],
  projects: [] as Record<string, unknown>[],
  rates: [] as Record<string, unknown>[],
  /** SKU name whose FIRST item insert should fail, to exercise the stop path. */
  failItemInsertFor: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "procurement_manager" })),
}));

function table(name: string) {
  return {
    select() {
      const data =
        name === "equipment_catalog_items"
          ? state.skus
          : name === "equipment_items"
            ? state.items
            : name === "equipment_owners"
              ? state.owners
              : name === "projects"
                ? state.projects
                : [];
      const resolved = { data, error: null };
      return {
        ...resolved,
        order() {
          return resolved;
        },
        then(onFulfilled: (v: unknown) => unknown) {
          return Promise.resolve(resolved).then(onFulfilled);
        },
      };
    },
    insert(payload: Record<string, unknown>) {
      state.inserts.push({ table: name, payload });
      const failing =
        name === "equipment_items" &&
        state.failItemInsertFor !== null &&
        String(payload.name ?? "").startsWith(state.failItemInsertFor);
      return {
        then(onFulfilled: (v: unknown) => unknown) {
          return Promise.resolve({ error: failing ? { code: "42501" } : null }).then(onFulfilled);
        },
      };
    },
  };
}

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    from: table,
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcs.push({ fn, args });
      return Promise.resolve({ error: null });
    },
  }),
}));

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: () => ({
      select() {
        return Promise.resolve({ data: state.rates, error: null });
      },
    }),
  }),
}));

import { bulkAddEquipmentFromCatalog } from "@/app/equipment/actions";

const PRI = "a43fdea5-4e94-4065-9ac7-182da0692348";
const PROJECT = "a88af871-019b-4eca-a7aa-f05244c83e5d";
const SKU_DRILL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const SKU_HOSE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const HEADER = "ทะเบียน\tจำนวน\tเจ้าของ\tที่ตั้ง";

beforeEach(() => {
  state.inserts = [];
  state.rpcs = [];
  state.failItemInsertFor = null;
  state.skus = [
    {
      id: SKU_DRILL,
      name: "สว่านไฟฟ้า",
      category_id: "c1",
      brand: "MAKITA",
      model: null,
      default_tracking: "unit",
      is_active: true,
    },
    {
      id: SKU_HOSE,
      name: "สายยางวัดระดับน้ำ",
      category_id: "c1",
      brand: null,
      model: null,
      default_tracking: "bulk",
      is_active: true,
    },
  ];
  state.items = [{ equipment_catalog_item_id: SKU_DRILL }];
  state.owners = [{ id: PRI, name: "Preston International Co., Ltd.", is_default: true }];
  state.projects = [{ id: PROJECT, name: "TFM นายาว เพชรบูรณ์" }];
  state.rates = [
    { id: SKU_DRILL, default_daily_rate: 300 },
    { id: SKU_HOSE, default_daily_rate: null },
  ];
});

describe("bulkAddEquipmentFromCatalog — ตรวจสอบ (dry run)", () => {
  it("writes NOTHING and reports each line's effect in words", async () => {
    const result = await bulkAddEquipmentFromCatalog(`${HEADER}\nสว่านไฟฟ้า\t2\t\t`, {
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(2);
    expect(result.preview).toEqual(["สร้าง 2 เครื่อง (สว่านไฟฟ้า No.2–No.3) · รับเข้าคลัง"]);
    expect(state.inserts).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });

  it("reports parse errors and writes nothing", async () => {
    const result = await bulkAddEquipmentFromCatalog(`${HEADER}\nสว่านลม\t1\t\t`, { dryRun: true });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(state.inserts).toEqual([]);
  });
});

describe("bulkAddEquipmentFromCatalog — นำเข้า (commit)", () => {
  it("writes N unit rows continuing the LIVE numbering, each with its movement", async () => {
    const result = await bulkAddEquipmentFromCatalog(`${HEADER}\nสว่านไฟฟ้า\t2\t\t`, {
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(2);

    const items = state.inserts.filter((c) => c.table === "equipment_items");
    expect(items.map((c) => (c.payload as Record<string, unknown>).name)).toEqual([
      "สว่านไฟฟ้า No.2",
      "สว่านไฟฟ้า No.3",
    ]);
    expect(items[0]?.payload).toMatchObject({
      category_id: "c1",
      owner_id: PRI,
      supplier_id: PRI,
      tracking: "unit",
      status: "available",
      brand: "MAKITA",
      equipment_catalog_item_id: SKU_DRILL,
      created_by: "u1",
    });

    const moves = state.inserts.filter((c) => c.table === "equipment_movements");
    expect(moves).toHaveLength(2);
    expect(moves[0]?.payload).toMatchObject({ kind: "received", project_id: null, quantity: 1 });
  });

  it("writes ONE bulk row carrying the quantity, and its movement moves all of it", async () => {
    const result = await bulkAddEquipmentFromCatalog(`${HEADER}\nสายยางวัดระดับน้ำ\t200\t\t`, {
      dryRun: false,
    });

    expect(result.created).toBe(1);
    const items = state.inserts.filter((c) => c.table === "equipment_items");
    expect(items).toHaveLength(1);
    expect(items[0]?.payload).toMatchObject({
      name: "สายยางวัดระดับน้ำ",
      tracking: "bulk",
      quantity: 200,
      asset_tag: null,
    });
    const moves = state.inserts.filter((c) => c.table === "equipment_movements");
    expect(moves[0]?.payload).toMatchObject({ kind: "received", quantity: 200 });
  });

  it("carries a named site into a deployed movement", async () => {
    await bulkAddEquipmentFromCatalog(`${HEADER}\nสว่านไฟฟ้า\t1\t\tTFM นายาว เพชรบูรณ์`, {
      dryRun: false,
    });

    const moves = state.inserts.filter((c) => c.table === "equipment_movements");
    expect(moves[0]?.payload).toMatchObject({ kind: "deployed", project_id: PROJECT });
  });

  it("copies the SKU default rate through the audited RPC, once per created row", async () => {
    await bulkAddEquipmentFromCatalog(`${HEADER}\nสว่านไฟฟ้า\t2\t\t`, { dryRun: false });

    expect(state.rpcs.map((r) => r.fn)).toEqual([
      "set_equipment_daily_rate",
      "set_equipment_daily_rate",
    ]);
    expect(state.rpcs[0]?.args).toMatchObject({ p_rate: 300 });
  });

  it("skips the rate RPC for a SKU with no default rather than writing a zero", async () => {
    await bulkAddEquipmentFromCatalog(`${HEADER}\nสายยางวัดระดับน้ำ\t5\t\t`, { dryRun: false });

    expect(state.rpcs).toEqual([]);
  });

  it("stops on a failed insert and reports what landed, naming the SKU", async () => {
    state.failItemInsertFor = "สว่านไฟฟ้า No.3";

    const result = await bulkAddEquipmentFromCatalog(`${HEADER}\nสว่านไฟฟ้า\t3\t\t`, {
      dryRun: false,
    });

    expect(result.ok).toBe(false);
    // No rollback is possible over PostgREST, so the count must be the truth.
    expect(result.created).toBe(1);
    expect(result.stoppedAt).toBe("สว่านไฟฟ้า");
    expect(result.errors.join(" ")).toContain("สว่านไฟฟ้า");
  });

  it("refuses a bulk SKU that already owns a row, before writing anything", async () => {
    state.items = [{ equipment_catalog_item_id: SKU_HOSE }];

    const result = await bulkAddEquipmentFromCatalog(`${HEADER}\nสายยางวัดระดับน้ำ\t5\t\t`, {
      dryRun: false,
    });

    expect(result.ok).toBe(false);
    expect(state.inserts).toEqual([]);
  });
});
