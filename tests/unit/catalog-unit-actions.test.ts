// Spec 361 U8 — the /catalog/units server actions: RPC name, argument names,
// and error mapping.
//
// The argument NAMES are the contract with three SECURITY DEFINER functions;
// a typo'd key is silently dropped by PostgREST and the parameter falls back to
// its SQL default. That is exactly how the live `p_abbr_short` defect worked:
// omit the key, get NULL, wipe the stored abbreviation on every edit. Nothing
// in the app or the type system catches it — this test does.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async () => ({ error: null as unknown })));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ role: "procurement_manager" })),
}));
vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));

import {
  createCatalogUnit,
  setCatalogUnitActive,
  updateCatalogUnit,
} from "@/app/catalog/units/actions";

const INPUT = {
  code: "  หลอด  ",
  displayName: "  หลอด  ",
  abbrShort: "ล.",
  unitClass: "count" as const,
  sortOrder: 26,
};

beforeEach(() => {
  rpc.mockClear();
  rpc.mockResolvedValue({ error: null });
});

describe("createCatalogUnit", () => {
  it("calls create_catalog_unit with the live argument names, trimmed", async () => {
    const result = await createCatalogUnit(INPUT);
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("create_catalog_unit", {
      p_code: "หลอด",
      p_display_name: "หลอด",
      p_abbr_short: "ล.",
      p_unit_class: "count",
      p_sort_order: 26,
    });
  });

  it("maps a duplicate code to a message that names the cause", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "23505" } });
    expect(await createCatalogUnit(INPUT)).toEqual({
      ok: false,
      error: "มีหน่วยนับรหัสนี้อยู่แล้ว",
    });
  });

  it("maps the RPC's role refusal to a permission message", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "42501" } });
    expect(await createCatalogUnit(INPUT)).toEqual({
      ok: false,
      error: "ไม่มีสิทธิ์แก้ไขหน่วยนับ",
    });
  });

  it("rejects a non-integer sort order before it reaches the RPC", async () => {
    const result = await createCatalogUnit({ ...INPUT, sortOrder: 1.5 });
    expect(result).toEqual({ ok: false, error: "ลำดับการแสดงต้องเป็นจำนวนเต็ม" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a blank name before it reaches the RPC", async () => {
    const result = await createCatalogUnit({ ...INPUT, displayName: "   " });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateCatalogUnit", () => {
  it("SENDS p_abbr_short — the RPC assigns it unconditionally, so omitting it wipes it", async () => {
    await updateCatalogUnit(INPUT);
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("update_catalog_unit");
    expect(args).toHaveProperty("p_abbr_short", "ล.");
  });

  it("omits the key for a null abbreviation — the RPC's own NULL default clears it", async () => {
    await updateCatalogUnit({ ...INPUT, abbrShort: null });
    const [, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args).not.toHaveProperty("p_abbr_short");
  });

  it("maps the unknown-code refusal to not-found", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "22023" } });
    expect(await updateCatalogUnit(INPUT)).toEqual({ ok: false, error: "ไม่พบหน่วยนับนี้" });
  });
});

describe("setCatalogUnitActive", () => {
  it("calls set_catalog_unit_active with its two live arguments", async () => {
    await setCatalogUnitActive({ code: " เส้น ", isActive: false });
    expect(rpc).toHaveBeenCalledWith("set_catalog_unit_active", {
      p_code: "เส้น",
      p_is_active: false,
    });
  });
});
