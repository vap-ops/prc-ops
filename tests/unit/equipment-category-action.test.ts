// Spec 361 U6 — the renameEquipmentCategory action.
//
// This is a raw table UPDATE (not an RPC): the live policy admits the five
// back-office roles and `authenticated` holds a column-scoped UPDATE grant on
// exactly (name, parent_id). Two things must be pinned because nothing else
// catches them: the row FILTER — an update without `.eq("id", …)` renames every
// category RLS lets the caller see — and that the write touches `name` only.

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  table: null as string | null,
  payload: null as Record<string, unknown> | null,
  filters: [] as Array<[string, unknown]>,
  error: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ id: "u1", role: "procurement_manager" })),
}));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    from(table: string) {
      calls.table = table;
      return {
        update(payload: Record<string, unknown>) {
          calls.payload = payload;
          const chain = {
            eq(column: string, value: unknown) {
              calls.filters.push([column, value]);
              return chain;
            },
            then: (resolve: (r: { error: unknown }) => unknown) =>
              Promise.resolve({ error: calls.error }).then(resolve),
          };
          return chain;
        },
      };
    },
  }),
}));

import { renameEquipmentCategory } from "@/app/equipment/actions";

const ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  calls.table = null;
  calls.payload = null;
  calls.filters = [];
  calls.error = null;
});

describe("renameEquipmentCategory", () => {
  it("updates ONE row — the id filter is what stops a mass rename", async () => {
    const result = await renameEquipmentCategory({ id: ID, name: "  รถขุดตีนตะขาบ  " });
    expect(result).toEqual({ ok: true });
    expect(calls.table).toBe("equipment_categories");
    expect(calls.filters).toEqual([["id", ID]]);
  });

  it("writes the trimmed name and nothing else — the grant covers name/parent_id only", async () => {
    await renameEquipmentCategory({ id: ID, name: "  รถขุดตีนตะขาบ  " });
    expect(calls.payload).toEqual({ name: "รถขุดตีนตะขาบ" });
  });

  it("rejects a malformed id before touching the database", async () => {
    const result = await renameEquipmentCategory({ id: "not-a-uuid", name: "x" });
    expect(result.ok).toBe(false);
    expect(calls.table).toBeNull();
  });

  it("rejects a blank or over-long name before touching the database", async () => {
    expect((await renameEquipmentCategory({ id: ID, name: "   " })).ok).toBe(false);
    expect((await renameEquipmentCategory({ id: ID, name: "ก".repeat(81) })).ok).toBe(false);
    expect(calls.table).toBeNull();
  });

  it("maps the policy refusal to a permission message", async () => {
    calls.error = { code: "42501" };
    expect(await renameEquipmentCategory({ id: ID, name: "รถขุดใหม่" })).toEqual({
      ok: false,
      error: "ไม่มีสิทธิ์แก้ไขหมวดหมู่",
    });
  });
});
