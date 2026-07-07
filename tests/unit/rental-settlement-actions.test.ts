// Writing failing test first.
//
// Spec 275 U3 — the rental-settlement server actions. Each does a friendly early
// requireRole(BACK_OFFICE_ROLES) check (defense-in-depth; the SECURITY DEFINER RPC
// re-gates the 5-role create-audience) then relays through the RLS session client
// to record_rental_settlement / supersede_rental_settlement. Tests pin: a
// non-allowed role is bounced before any RPC; an allowed role calls the RPC with
// the exact arg shape (p_note OMITTED when empty, per exactOptionalPropertyTypes);
// bad payloads never reach the RPC; RPC errors map to friendly results.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, rpc } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { recordRentalSettlement, supersedeRentalSettlement } from "@/app/equipment/rentals/actions";

const AGREEMENT = "11111111-1111-4111-8111-111111111111";
const SETTLEMENT = "22222222-2222-4222-8222-222222222222";

function baseInput() {
  return {
    agreementId: AGREEMENT,
    invoiceNo: "INV-001",
    invoiceDate: "2026-07-08",
    base: 90000,
    overtime: 5000,
    fees: 1500,
    vat: 6755,
    depositRefunded: 0,
    depositForfeited: 0,
    method: "bank_transfer",
    note: "",
  };
}

function denyRole() {
  requireRole.mockImplementation(() => {
    throw new Error("__redirect__");
  });
}

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ id: "u1", role: "procurement", fullName: null });
  rpc.mockReset().mockResolvedValue({ data: SETTLEMENT, error: null });
});

describe("recordRentalSettlement (spec 275 U3)", () => {
  it("bounces a non-allowed role before any RPC", async () => {
    denyRole();
    await expect(recordRentalSettlement(baseInput())).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls record_rental_settlement with the exact args, omitting p_note when empty", async () => {
    const r = await recordRentalSettlement(baseInput());
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("record_rental_settlement", {
      p_agreement_id: AGREEMENT,
      p_invoice_no: "INV-001",
      p_invoice_date: "2026-07-08",
      p_base: 90000,
      p_overtime: 5000,
      p_fees: 1500,
      p_vat: 6755,
      p_deposit_refunded: 0,
      p_deposit_forfeited: 0,
      p_method: "bank_transfer",
    });
  });

  it("includes p_note when provided (trimmed)", async () => {
    await recordRentalSettlement({ ...baseInput(), note: "  คืนมัดจำครบ  " });
    expect(rpc).toHaveBeenCalledWith(
      "record_rental_settlement",
      expect.objectContaining({ p_note: "คืนมัดจำครบ" }),
    );
  });

  it("rejects a blank invoice number before the RPC", async () => {
    const r = await recordRentalSettlement({ ...baseInput(), invoiceNo: "   " });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a blank invoice date before the RPC", async () => {
    const r = await recordRentalSettlement({ ...baseInput(), invoiceDate: "" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a negative amount before the RPC", async () => {
    const r = await recordRentalSettlement({ ...baseInput(), overtime: -1 });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown payment method before the RPC", async () => {
    const r = await recordRentalSettlement({ ...baseInput(), method: "crypto" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid agreement before the RPC", async () => {
    const r = await recordRentalSettlement({ ...baseInput(), agreementId: "nope" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a 42501 permission error to a friendly result", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const r = await recordRentalSettlement(baseInput());
    expect(r.ok).toBe(false);
  });

  it("maps a P0001 validation error to a friendly result", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "net mismatch" } });
    const r = await recordRentalSettlement(baseInput());
    expect(r.ok).toBe(false);
  });
});

describe("supersedeRentalSettlement (spec 275 U3)", () => {
  function supersedeInput() {
    return {
      ...baseInput(),
      method: "cash",
      note: "โน้ต",
      settlementId: SETTLEMENT,
      correctionReason: "แก้ยอดค่าล่วงเวลา",
    };
  }

  it("calls supersede_rental_settlement with the settlement id + correction reason (no p_agreement_id)", async () => {
    const r = await supersedeRentalSettlement(supersedeInput());
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("supersede_rental_settlement", {
      p_settlement_id: SETTLEMENT,
      p_correction_reason: "แก้ยอดค่าล่วงเวลา",
      p_invoice_no: "INV-001",
      p_invoice_date: "2026-07-08",
      p_base: 90000,
      p_overtime: 5000,
      p_fees: 1500,
      p_vat: 6755,
      p_deposit_refunded: 0,
      p_deposit_forfeited: 0,
      p_method: "cash",
      p_note: "โน้ต",
    });
  });

  it("rejects a blank correction reason before the RPC", async () => {
    const r = await supersedeRentalSettlement({ ...supersedeInput(), correctionReason: "  " });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid settlement id before the RPC", async () => {
    const r = await supersedeRentalSettlement({ ...supersedeInput(), settlementId: "nope" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("bounces a non-allowed role before any RPC", async () => {
    denyRole();
    await expect(supersedeRentalSettlement(supersedeInput())).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
