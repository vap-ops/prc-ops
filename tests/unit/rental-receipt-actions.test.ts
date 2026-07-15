// Writing failing test first.
//
// Spec 323 U1d — addRentalSettlementReceipt: writes the receipt metadata row for a
// rental settlement. rental_settlement_attachments is a ZERO-GRANT money-adjacent
// table, so the write goes through the ADMIN (service-role) client behind
// requireRole(BACK_OFFICE_ROLES) — NOT the RLS client / an authenticated policy
// (which would join the zero-grant rental_settlements and always deny; the HIGH
// catch). The bytes were already uploaded to the private bucket by the client; this
// only inserts the metadata (server REBUILDS the canonical path). Idempotent on
// replay (23505).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, adminInsert, adminMaybeSingle, revalidatePath } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  adminInsert: vi.fn(),
  adminMaybeSingle: vi.fn(),
  revalidatePath: vi.fn(),
}));

// A tiny admin-client double: .from(table) → a builder supporting the two shapes we
// use (select…eq…maybeSingle for the settlement existence check; insert for the row).
const adminFrom = vi.fn((table: string) => {
  if (table === "rental_settlements") {
    return { select: () => ({ eq: () => ({ maybeSingle: adminMaybeSingle }) }) };
  }
  return { insert: adminInsert };
});

vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/db/admin", () => ({ createClient: () => ({ from: adminFrom }) }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { addRentalSettlementReceipt } from "@/app/equipment/rentals/receipt-actions";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";

const SETTLEMENT = "cc000323-0000-4000-8000-000000000001";
const ATTACHMENT = "dd000323-0000-4000-8000-000000000001";

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ id: "u-back-office", role: "procurement" });
  adminMaybeSingle.mockReset().mockResolvedValue({ data: { id: SETTLEMENT }, error: null });
  adminInsert.mockReset().mockResolvedValue({ error: null });
  revalidatePath.mockReset();
  adminFrom.mockClear();
});

describe("addRentalSettlementReceipt (spec 323 U1d)", () => {
  const good = {
    settlementId: SETTLEMENT,
    attachmentId: ATTACHMENT,
    ext: "pdf" as const,
    purpose: "tax_invoice" as const,
  };

  it("gates on BACK_OFFICE_ROLES", async () => {
    await addRentalSettlementReceipt(good);
    expect(requireRole).toHaveBeenCalledWith(BACK_OFFICE_ROLES);
  });

  it("bounces a non-back-office caller before any admin write", async () => {
    requireRole.mockImplementation(() => {
      throw new Error("__redirect__");
    });
    await expect(addRentalSettlementReceipt(good)).rejects.toThrow();
    expect(adminInsert).not.toHaveBeenCalled();
  });

  it("inserts the metadata via the admin client with a server-rebuilt path", async () => {
    const res = await addRentalSettlementReceipt(good);
    expect(res).toEqual({ ok: true });
    expect(adminInsert).toHaveBeenCalledWith({
      id: ATTACHMENT,
      settlement_id: SETTLEMENT,
      storage_path: `${SETTLEMENT}/${ATTACHMENT}.pdf`,
      purpose: "tax_invoice",
      uploaded_by: "u-back-office",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/equipment/rentals");
  });

  it("refuses an unknown settlement (admin existence check fails) — no insert", async () => {
    adminMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await addRentalSettlementReceipt(good);
    expect(res.ok).toBe(false);
    expect(adminInsert).not.toHaveBeenCalled();
  });

  it("rejects a bad ext / purpose / uuid before touching the DB", async () => {
    expect((await addRentalSettlementReceipt({ ...good, ext: "exe" as never })).ok).toBe(false);
    expect((await addRentalSettlementReceipt({ ...good, purpose: "nope" as never })).ok).toBe(
      false,
    );
    expect((await addRentalSettlementReceipt({ ...good, settlementId: "x" })).ok).toBe(false);
    expect(adminInsert).not.toHaveBeenCalled();
  });

  it("treats a 23505 replay as success (idempotent)", async () => {
    adminInsert.mockResolvedValue({ error: { code: "23505" } });
    expect((await addRentalSettlementReceipt(good)).ok).toBe(true);
  });

  it("surfaces a non-23505 insert error", async () => {
    adminInsert.mockResolvedValue({ error: { code: "42501" } });
    expect((await addRentalSettlementReceipt(good)).ok).toBe(false);
  });
});
