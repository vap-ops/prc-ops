// Spec 397 U4 — the office team's own refusal copy.
//
// `muster_scan_in` names the other team by its LEAD ("อยู่ในทีมของ <หัวหน้า>").
// An office team has no lead, so U4 gave the RPC its own message — and without a
// mapper arm for it the SA would meet the ordered mapper's generic instead, which
// says the worker is in "another team" and gives them nothing to act on.
//
// Gate + client mocked (the muster-undo-action.test.ts harness): this pins the
// mapping, not the database.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { musterScan } from "@/lib/muster/actions";

const TEAM = "11111111-1111-1111-1111-111111111111";
const WORKER = "22222222-2222-2222-2222-222222222222";
const REVALIDATE = "/projects/x/muster";

async function errorFor(message: string) {
  rpc.mockResolvedValue({ data: null, error: { message } });
  const r = await musterScan({
    teamId: TEAM,
    workerId: WORKER,
    mode: "in",
    method: "qr",
    session: "regular",
    revalidate: REVALIDATE,
  });
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
}

beforeEach(() => {
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc } });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("spec 397 U4 — the office team gets its own refusal copy", () => {
  it("names the OFFICE team, not 'another team'", async () => {
    const e = await errorFor("muster_scan_in: worker is already in the office team today");
    expect(e).toContain("ทีมสำนักงาน");
    // The crew fallbacks must not swallow it — those say ทีมอื่น / ทีมของ, which
    // is what the SA was told before this arm existed.
    expect(e).not.toContain("ทีมอื่น");
    expect(e).not.toContain("ทีมของ");
  });

  it("still names a CREW team by its lead", async () => {
    const e = await errorFor("muster_scan_in: worker already in team of สมชาย today");
    expect(e).toContain("สมชาย");
    expect(e).not.toContain("ทีมสำนักงาน");
  });

  it("keeps the cross-project fallback distinct from both", async () => {
    const e = await errorFor("muster_scan_in: worker is already mustered elsewhere today");
    expect(e).toContain("ทีมอื่น");
    expect(e).not.toContain("ทีมสำนักงาน");
  });
});
