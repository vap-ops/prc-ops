// Writing failing test first.
//
// Spec 233 / ADR 0067 U5 — the claim action relays a trimmed token to the
// claim_client_invite RPC through the caller's RLS session (never admin), and
// maps the RPC raise messages to Thai. An empty token short-circuits.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

import { claimClientInvite } from "@/lib/client-portal/actions";

beforeEach(() => {
  getUser.mockReset();
  rpc.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("claimClientInvite", () => {
  it("rejects an empty token without calling the RPC", async () => {
    const r = await claimClientInvite({ token: "  " });
    expect(r).toEqual({ ok: false, error: "ลิงก์ไม่ถูกต้อง" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("relays the trimmed token to claim_client_invite and succeeds", async () => {
    rpc.mockResolvedValue({ error: null });
    const r = await claimClientInvite({ token: "  tok-1 " });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("claim_client_invite", { p_token: "tok-1" });
  });

  it("maps the visitor-only RPC error to Thai (no silent role flip)", async () => {
    rpc.mockResolvedValue({ error: { message: "claim_client_invite: only a visitor may claim" } });
    const r = await claimClientInvite({ token: "tok-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ผู้ใช้ภายในระบบ");
  });

  it("maps an expired token to Thai", async () => {
    rpc.mockResolvedValue({ error: { message: "claim_client_invite: token expired" } });
    const r = await claimClientInvite({ token: "tok-3" });
    expect(r).toEqual({ ok: false, error: "ลิงก์หมดอายุแล้ว" });
  });

  it("maps an already-used token to Thai", async () => {
    rpc.mockResolvedValue({ error: { message: "claim_client_invite: token already used" } });
    const r = await claimClientInvite({ token: "tok-4" });
    expect(r).toEqual({ ok: false, error: "ลิงก์นี้ถูกใช้ไปแล้ว" });
  });
});
