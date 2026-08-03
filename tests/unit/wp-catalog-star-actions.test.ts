// Spec 389 U5 — star-actions error mapping + gates. The 42501/22023 →
// honest-copy branches are the module's whole value: a permanent refusal must
// never read as "ลองใหม่" (the honest-copy class), and requireRole must run
// before any RPC call.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: (...args: unknown[]) => requireRole(...args) as unknown,
}));
vi.mock("@/lib/db/server", () => ({
  createClient: () => Promise.resolve({ rpc }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { starReferencePhoto, unstarReferencePhoto } from "@/lib/wp-catalog/star-actions";

const P = "11111111-1111-1111-1111-111111111111";
const W = "22222222-2222-2222-2222-222222222222";
const PH = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ id: "u", role: "project_director" });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("star-actions", () => {
  it("gates on the exact PD tier before calling the RPC", async () => {
    await starReferencePhoto(P, W, PH);
    expect(requireRole).toHaveBeenCalledWith(["project_director", "super_admin"]);
    expect(rpc).toHaveBeenCalledWith("star_reference_photo", { p_photo_log_id: PH });
  });

  it("unstar calls the unstar RPC", async () => {
    await unstarReferencePhoto(P, W, PH);
    expect(rpc).toHaveBeenCalledWith("unstar_reference_photo", { p_photo_log_id: PH });
  });

  it("refuses malformed uuids WITHOUT touching the RPC", async () => {
    const res = await starReferencePhoto(P, W, "not-a-uuid");
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("42501 maps to the role refusal — and never says ลองใหม่", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    const res = await starReferencePhoto(P, W, PH);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ผู้อำนวยการโครงการ");
    expect(res.error).not.toContain("ลองใหม่");
  });

  it("22023 maps to the validity refusal — and never says ลองใหม่", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "x" } });
    const res = await starReferencePhoto(P, W, PH);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("จับคู่");
    expect(res.error).not.toContain("ลองใหม่");
  });

  it("an unknown error keeps the retryable generic copy", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "x" } });
    const res = await starReferencePhoto(P, W, PH);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ลองใหม่");
  });
});
