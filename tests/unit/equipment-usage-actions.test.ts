// Spec 363 U7 / spec 370 — the borrow/return server actions carry the evidence
// contract: ≥1 REAL condition photo BOTH directions (370 D4 — path shape AND
// storage existence, because a well-formed string with no object behind it
// would satisfy the gate with zero photos taken), door attribution with a
// runtime via-allowlist, the bulk refusal at the action layer (F7 — the RPC
// has no tracking guard and an action is a public endpoint), and the failure
// order upload→RPC→photo-rows.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const photoInsert = vi.fn();
const itemMaybeSingle = vi.fn();
const photoSelectChain = {
  select: vi.fn(() => photoSelectChain),
  eq: vi.fn(() => photoSelectChain),
  limit: vi.fn(),
};
const from = vi.fn((table: string) => {
  if (table === "equipment_items") {
    return { select: () => ({ eq: () => ({ maybeSingle: itemMaybeSingle }) }) };
  }
  if (table === "equipment_usage_photos") {
    return {
      insert: photoInsert,
      select: photoSelectChain.select,
    };
  }
  throw new Error(`unexpected table ${table}`);
});
const getUser = vi.fn();
const createSignedUrls = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ rpc, from, auth: { getUser } }),
}));
vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({ storage: { from: () => ({ createSignedUrls }) } }),
}));
const mintSignedUrls = vi.fn();
vi.mock("@/lib/storage/signed-urls", () => ({
  mintSignedUrls: (...a: unknown[]) => mintSignedUrls(...a),
}));

import {
  checkInEquipment,
  checkOutEquipment,
  fetchLoanPhotoUrls,
} from "@/lib/equipment/usage-actions";

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
  photoInsert.mockReset().mockResolvedValue({ error: null });
  itemMaybeSingle.mockReset().mockResolvedValue({ data: { tracking: "unit" } });
  from.mockClear();
  getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { id: "3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d" } } });
  createSignedUrls
    .mockReset()
    .mockImplementation(async (paths: string[]) => ({
      data: paths.map((p) => ({ error: null, signedUrl: `https://s/${p}` })),
      error: null,
    }));
  mintSignedUrls.mockReset().mockResolvedValue(new Map());
  photoSelectChain.select.mockClear();
  photoSelectChain.eq.mockClear();
  photoSelectChain.limit.mockReset();
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

  it("refuses a well-shaped path with NO object behind it (existence check)", async () => {
    createSignedUrls.mockResolvedValue({
      data: [{ error: "Object not found", signedUrl: null }],
      error: null,
    });
    const res = await checkOutEquipment(OUT_INPUT);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses more than 6 photos (row-batch cap)", async () => {
    const res = await checkOutEquipment({
      ...OUT_INPUT,
      photoPaths: Array.from({ length: 7 }, (_, i) => `usage/a/${i}.jpg`),
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an unknown via value at the boundary", async () => {
    const res = await checkOutEquipment({
      ...OUT_INPUT,
      via: "teleport" as never,
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a BULK item before the RPC (F7 — the action layer owns this guard)", async () => {
    itemMaybeSingle.mockResolvedValue({ data: { tracking: "bulk" } });
    const res = await checkOutEquipment(OUT_INPUT);
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
    expect(photoInsert).toHaveBeenCalledWith([
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
    expect(photoInsert).not.toHaveBeenCalled();
  });

  it("a failed photo-row insert surfaces honestly — no phantom add-photo-later door", async () => {
    photoInsert.mockResolvedValue({ error: { message: "boom" } });
    const res = await checkOutEquipment(OUT_INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("บันทึกยืมแล้ว");
      expect(res.error).not.toContain("เพิ่มรูปอีกครั้ง");
    }
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
    expect(photoInsert).toHaveBeenCalledWith([
      {
        log_id: IN_INPUT.logId,
        phase: "in",
        storage_path: "usage/abc/2.jpg",
        taken_by: "3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d",
      },
    ]);
  });
});

describe("fetchLoanPhotoUrls — on-open minting for the compare strip", () => {
  it("reads out-phase rows under RLS, mints, returns urls in row order", async () => {
    photoSelectChain.limit.mockResolvedValue({
      data: [
        { id: "p1", storage_path: "usage/a/1.jpg" },
        { id: "p2", storage_path: "usage/a/2.jpg" },
      ],
      error: null,
    });
    mintSignedUrls.mockResolvedValue(
      new Map([
        ["p1", "https://s/1"],
        ["p2", "https://s/2"],
      ]),
    );
    const res = await fetchLoanPhotoUrls("5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f");
    expect(res).toEqual({ ok: true, urls: ["https://s/1", "https://s/2"] });
  });

  it("a refused RLS read (non-staff) reports ok:false, never leaks paths", async () => {
    photoSelectChain.limit.mockResolvedValue({ data: null, error: { message: "denied" } });
    const res = await fetchLoanPhotoUrls("5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f");
    expect(res).toEqual({ ok: false });
    expect(mintSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid log id at the boundary", async () => {
    const res = await fetchLoanPhotoUrls("../etc/passwd");
    expect(res).toEqual({ ok: false });
  });
});
