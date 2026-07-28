// Spec 363 U7 / spec 370 — the borrow/return server actions carry the evidence
// contract: ≥1 condition photo BOTH directions (370 D4 — enforced per DOOR at
// the action layer, because the RPC cannot see photos), door attribution
// (p_via), optional borrower, and the failure order upload→RPC→photo-rows (a
// failed RPC must not leave photo rows pretending success; a failed photo-row
// insert must surface, not silently drop evidence).

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const insert = vi.fn();
const from = vi.fn(() => ({ insert }));
const getUser = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ rpc, from, auth: { getUser } }),
}));

import { checkInEquipment, checkOutEquipment } from "@/lib/equipment/usage-actions";

const OUT_INPUT = {
  workPackageId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
  itemId: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
  checkoutDate: "2026-07-28",
  revalidate: "/x",
  via: "wp_tab" as const,
  photoPaths: ["usage/abc/1.jpg"],
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c", error: null });
  insert.mockReset().mockResolvedValue({ error: null });
  from.mockClear();
  getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d" } } });
});

describe("spec 370 D4 — checkOutEquipment evidence contract", () => {
  it("refuses with ZERO photos — the requirement must not leak on any door", async () => {
    const res = await checkOutEquipment({ ...OUT_INPUT, photoPaths: [] });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a photo path outside usage/ (the storage policy's prefix)", async () => {
    const res = await checkOutEquipment({ ...OUT_INPUT, photoPaths: ["evil/1.jpg"] });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes door + borrower to the RPC, then inserts phase-out photo rows keyed to the returned log id", async () => {
    const res = await checkOutEquipment({
      ...OUT_INPUT,
      borrowerWorkerId: "4e4e4e4e-4e4e-4e4e-8e4e-4e4e4e4e4e4e",
    });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_out_equipment", {
      p_item: OUT_INPUT.itemId,
      p_wp: OUT_INPUT.workPackageId,
      p_date: OUT_INPUT.checkoutDate,
      p_via: "wp_tab",
      p_borrower_worker_id: "4e4e4e4e-4e4e-4e4e-8e4e-4e4e4e4e4e4e",
    });
    expect(from).toHaveBeenCalledWith("equipment_usage_photos");
    expect(insert).toHaveBeenCalledWith([
      {
        log_id: "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c",
        phase: "out",
        storage_path: "usage/abc/1.jpg",
        taken_by: "3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d",
      },
    ]);
  });

  it("a failed RPC inserts NO photo rows (failure order)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "x" } });
    const res = await checkOutEquipment(OUT_INPUT);
    expect(res.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("a failed photo-row insert surfaces as failure — evidence must not silently drop", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    const res = await checkOutEquipment(OUT_INPUT);
    expect(res.ok).toBe(false);
  });
});

describe("spec 370 D4 — checkInEquipment evidence contract", () => {
  const IN_INPUT = {
    logId: "5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f",
    checkinDate: "2026-07-28",
    revalidate: "/x",
    via: "store" as const,
    photoPaths: ["usage/abc/2.jpg"],
  };

  it("refuses with zero photos", async () => {
    const res = await checkInEquipment({ ...IN_INPUT, photoPaths: [] });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("photo rows key to the ORIGINAL log id (the supersede trap), phase in, door = store", async () => {
    const res = await checkInEquipment(IN_INPUT);
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_in_equipment", {
      p_log: IN_INPUT.logId,
      p_date: IN_INPUT.checkinDate,
      p_via: "store",
    });
    expect(insert).toHaveBeenCalledWith([
      {
        log_id: IN_INPUT.logId,
        phase: "in",
        storage_path: "usage/abc/2.jpg",
        taken_by: "3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d",
      },
    ]);
  });
});
