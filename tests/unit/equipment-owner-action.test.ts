// Bug 2026-07-30 — the createEquipmentOwner action.
//
// `createEquipment` / `updateEquipment` / `importEquipmentCsv` all write
// `supplier_id = ownerId` (spec 275 U0 id-mirrors an owner into `suppliers` to
// keep the GL-party edge in step), and `equipment_items.supplier_id` is an FK to
// `public.suppliers` — verified live. So an owner row with no same-id supplier
// row 23503s on the FIRST item created under it, surfaced as the generic
// "บันทึกอุปกรณ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง": a permanent failure dressed as a
// retry. Migration …_075881_ mirrored the PRI owner BY HAND, which is the tell —
// the app layer is the half that forgot.
//
// Why these assertions and not others:
//
//   * ORDER is the whole design, not an implementation detail. `authenticated`
//     has NO DELETE on `suppliers` and there are ZERO delete policies (live), so
//     a compensating rollback is impossible and the action cannot be atomic
//     without a DEFINER RPC (a migration — deliberately a follow-up, the schema
//     lane is held). Supplier-FIRST makes every outcome preserve the invariant:
//     a mid-flight failure leaves at worst a spare supplier, never a mirror-less
//     owner. Owner-first would re-create exactly this bug.
//   * SAME id on both rows — the mirror is an identity copy (spec 275: `insert
//     into suppliers (id, name, phone, created_by, created_at) select eo.id, …`),
//     so `supplier_id = owner_id` resolves. A fresh uuid on either side is the
//     bug with extra steps.
//   * A FAILED supplier insert must abort BEFORE the owner insert. Otherwise the
//     ordering above buys nothing.
//   * The owner insert must still carry name/phone/created_by unchanged — the
//     `equipment_owners insert by back office` policy requires
//     `created_by = auth.uid()`, so dropping it turns the fix into a 42501.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface InsertCall {
  table: string;
  payload: Record<string, unknown>;
}

const calls = vi.hoisted(() => ({
  inserts: [] as InsertCall[],
  // Keyed by table so a test can fail ONE leg of the pair and watch the other.
  errors: {} as Record<string, unknown>,
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
          calls.inserts.push({ table, payload });
          return Promise.resolve({ error: calls.errors[table] ?? null });
        },
      };
    },
  }),
}));

import { createEquipmentOwner } from "@/app/equipment/actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  calls.inserts = [];
  calls.errors = {};
});

describe("createEquipmentOwner — the suppliers id-mirror", () => {
  it("writes the suppliers row FIRST, then the owner — the order is the rollback we cannot have", async () => {
    const result = await createEquipmentOwner({
      name: "  ห้างหุ้นส่วน ทดสอบ  ",
      phone: " 021234567 ",
    });

    expect(result).toEqual({ ok: true });
    expect(calls.inserts.map((c) => c.table)).toEqual(["suppliers", "equipment_owners"]);
  });

  it("mirrors by IDENTITY — both rows carry the same generated uuid", async () => {
    await createEquipmentOwner({ name: "ห้างหุ้นส่วน ทดสอบ" });

    const [supplier, owner] = calls.inserts;
    expect(supplier?.payload.id).toEqual(expect.stringMatching(UUID_RE));
    expect(owner?.payload.id).toBe(supplier?.payload.id);
  });

  it("copies name/phone/created_by onto the mirror — suppliers.name and created_by are NOT NULL", async () => {
    await createEquipmentOwner({ name: "  ห้างหุ้นส่วน ทดสอบ  ", phone: " 021234567 " });

    const supplier = calls.inserts[0];
    // Pin the table too: without it this case passes against the bug, because
    // the lone equipment_owners insert carries the same three fields.
    expect(supplier?.table).toBe("suppliers");
    expect(supplier?.payload).toMatchObject({
      name: "ห้างหุ้นส่วน ทดสอบ",
      phone: "021234567",
      created_by: "u1",
    });
  });

  it("still writes the owner row unchanged — created_by = auth.uid() or the policy 42501s", async () => {
    await createEquipmentOwner({ name: "  ห้างหุ้นส่วน ทดสอบ  ", phone: "   " });

    const owner = calls.inserts[1];
    expect(owner?.table).toBe("equipment_owners");
    expect(owner?.payload).toMatchObject({
      name: "ห้างหุ้นส่วน ทดสอบ",
      phone: null,
      created_by: "u1",
    });
  });

  it("aborts before the owner insert when the mirror fails — no mirror, no owner", async () => {
    calls.errors.suppliers = { code: "42501" };

    const result = await createEquipmentOwner({ name: "ห้างหุ้นส่วน ทดสอบ" });

    expect(result.ok).toBe(false);
    expect(calls.inserts.map((c) => c.table)).toEqual(["suppliers"]);
  });

  it("reports failure when the owner insert fails", async () => {
    calls.errors.equipment_owners = { code: "23514" };

    const result = await createEquipmentOwner({ name: "ห้างหุ้นส่วน ทดสอบ" });

    expect(result.ok).toBe(false);
    // Both legs were attempted — otherwise this passes against the bug, where
    // the only insert there has ever been is the one that failed.
    expect(calls.inserts.map((c) => c.table)).toEqual(["suppliers", "equipment_owners"]);
  });

  it("rejects a blank or over-long name before touching either table", async () => {
    expect((await createEquipmentOwner({ name: "   " })).ok).toBe(false);
    expect((await createEquipmentOwner({ name: "ก".repeat(121) })).ok).toBe(false);
    expect(calls.inserts).toEqual([]);
  });

  it("rejects an over-long phone before touching either table", async () => {
    expect((await createEquipmentOwner({ name: "ทดสอบ", phone: "0".repeat(41) })).ok).toBe(false);
    expect(calls.inserts).toEqual([]);
  });
});
