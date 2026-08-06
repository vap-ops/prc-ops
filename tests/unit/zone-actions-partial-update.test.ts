// Writing failing test first.
//
// Spec 392 — `saveZone` must not manufacture a shape and a geometry on the
// UPDATE path.
//
// The bug, live since #958 and found by fresh-eyes review of U2b: `zone-sheet`
// (the rename/re-code sheet) sends {zoneId, code, name} and nothing else, and
// this action filled the gaps with `rect` + a default box, which
// `upsert_project_zone` then wrote over the zone's real shape and position.
// Migration `20260813075911` made a NULL mean "leave this column alone" — but
// that is only half a fix, because a caller that sends non-null defaults is
// invisible to any amount of coalescing. Both halves or neither.
//
// The RPC is mocked: what is under test is the ARGUMENT MAPPING, which is where
// the defect lived. The DB half is pinned in
// `supabase/tests/database/398-zone-upsert-partial.test.sql`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  requireActionRole: vi.fn(),
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
  NOT_PERMITTED: "ไม่มีสิทธิ์ทำรายการนี้",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { saveZone } from "@/app/projects/[projectId]/zones/actions";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const MAP = "22222222-2222-4222-8222-222222222222";
const ZONE = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: ZONE, error: null });
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc } });
});

/** The single argument object the action handed the RPC. */
function sentArgs(): Record<string, unknown> {
  expect(rpc).toHaveBeenCalledTimes(1);
  const call = rpc.mock.calls[0] as [string, Record<string, unknown>];
  expect(call[0]).toBe("upsert_project_zone");
  return call[1];
}

describe("saveZone — the rename path", () => {
  it("sends NULL shape and NULL geometry when the caller supplied neither", async () => {
    // This is exactly what zone-sheet.tsx sends.
    const result = await saveZone({
      projectId: PROJECT,
      mapId: MAP,
      zoneId: ZONE,
      code: "A",
      name: "พื้นลานด้านซ้ายของอาคาร",
    });

    expect(result).toEqual({ ok: true, id: ZONE });
    const args = sentArgs();
    expect(args.p_shape).toBeNull();
    expect(args.p_geometry).toBeNull();
  });

  it("sends NULL sort_order rather than 0 — a rename must not re-sort the map", async () => {
    await saveZone({ projectId: PROJECT, mapId: MAP, zoneId: ZONE, code: "A", name: "โซนเอ" });
    expect(sentArgs().p_sort_order).toBeNull();
  });

  it("still sends the code and the name, which are what a rename is FOR", async () => {
    await saveZone({
      projectId: PROJECT,
      mapId: MAP,
      zoneId: ZONE,
      code: "  A  ",
      name: "  โซนเอ  ",
    });
    const args = sentArgs();
    expect(args.p_code).toBe("A");
    expect(args.p_name).toBe("โซนเอ");
  });
});

describe("saveZone — the create path keeps its defaults", () => {
  it("a zone created from the list still gets a shape and a box to stand on", async () => {
    // The DB columns are NOT NULL, so a create with nulls would be a 23502.
    await saveZone({ projectId: PROJECT, mapId: MAP, code: "B", name: "ห้องถังน้ำดี" });
    const args = sentArgs();
    expect(args.p_zone_id).toBeNull();
    expect(args.p_shape).toBe("rect");
    expect(args.p_geometry).toEqual({ x: 0.1, y: 0.1, w: 0.3, h: 0.2 });
    expect(args.p_sort_order).toBe(0);
  });
});

describe("saveZone — the drag path is unaffected", () => {
  it("writes the shape and geometry the canvas sends", async () => {
    await saveZone({
      projectId: PROJECT,
      mapId: MAP,
      zoneId: ZONE,
      code: "A",
      name: "โซนเอ",
      shape: "polygon",
      geometry: {
        points: [
          [0.1, 0.1],
          [0.5, 0.1],
          [0.3, 0.5],
        ],
      },
    });
    const args = sentArgs();
    expect(args.p_shape).toBe("polygon");
    expect(args.p_geometry).toEqual({
      points: [
        [0.1, 0.1],
        [0.5, 0.1],
        [0.3, 0.5],
      ],
    });
  });

  it("still refuses geometry the DB would refuse, before the round trip", async () => {
    const result = await saveZone({
      projectId: PROJECT,
      mapId: MAP,
      zoneId: ZONE,
      code: "A",
      name: "โซนเอ",
      shape: "rect",
      geometry: { x: 0.9, y: 0.1, w: 0.5, h: 0.2 },
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("saveZone — shape and geometry are ONE fact", () => {
  it("refuses a shape with no geometry rather than pairing it with a stored one", async () => {
    // `{x,y,w,h}` under `polygon` is a row the DB CHECK refuses, so a caller
    // may not change one half and leave the DB to reconcile it with the other.
    const result = await saveZone({
      projectId: PROJECT,
      mapId: MAP,
      zoneId: ZONE,
      code: "A",
      name: "โซนเอ",
      shape: "polygon",
    });
    expect(result).toEqual({ ok: false, error: "ต้องระบุรูปทรงและตำแหน่งของโซนคู่กัน" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses geometry with no shape, the same way", async () => {
    const result = await saveZone({
      projectId: PROJECT,
      mapId: MAP,
      zoneId: ZONE,
      code: "A",
      name: "โซนเอ",
      geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    });
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
