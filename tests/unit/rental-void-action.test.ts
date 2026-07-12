// Writing failing test first.
//
// Spec 312 — voidRentalBatch server action. Friendly requireRole(BACK_OFFICE_ROLES)
// defense-in-depth (the SECURITY DEFINER RPC re-gates), then relays through the RLS
// session client to void_equipment_rental_batch. Tests pin: a non-allowed role is
// bounced before any RPC; an allowed role calls the RPC with the batch id + reason
// (p_reason OMITTED when blank, per exactOptionalPropertyTypes); a non-uuid never
// reaches the RPC; each RPC errcode (42501 / RB404 / RB409) maps to a friendly result.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, rpc } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { voidRentalBatch } from "@/app/equipment/rentals/actions";

const BATCH = "70d5c6d2-7b76-4380-a5f8-5d7c6666a98a";

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ id: "u1", role: "procurement", fullName: null });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("voidRentalBatch (spec 312)", () => {
  it("bounces a non-allowed role before any RPC", async () => {
    requireRole.mockImplementation(() => {
      throw new Error("__redirect__");
    });
    await expect(voidRentalBatch({ batchId: BATCH, reason: "test" })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls void_equipment_rental_batch with the batch id + trimmed reason", async () => {
    const r = await voidRentalBatch({ batchId: BATCH, reason: "  ทดสอบระบบ  " });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("void_equipment_rental_batch", {
      p_batch_id: BATCH,
      p_reason: "ทดสอบระบบ",
    });
  });

  it("omits p_reason when blank", async () => {
    await voidRentalBatch({ batchId: BATCH, reason: "   " });
    expect(rpc).toHaveBeenCalledWith("void_equipment_rental_batch", { p_batch_id: BATCH });
  });

  it("rejects a non-uuid batch id before the RPC", async () => {
    const r = await voidRentalBatch({ batchId: "nope", reason: "test" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a 42501 permission error to a friendly result", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const r = await voidRentalBatch({ batchId: BATCH, reason: "test" });
    expect(r.ok).toBe(false);
  });

  it("maps RB404 (unknown batch) to a friendly result", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "RB404", message: "not found" } });
    const r = await voidRentalBatch({ batchId: BATCH, reason: "test" });
    expect(r.ok).toBe(false);
  });

  it("maps RB409 (non-active / has downstream money) to a friendly result", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "RB409", message: "not active" } });
    const r = await voidRentalBatch({ batchId: BATCH, reason: "test" });
    expect(r.ok).toBe(false);
  });
});
