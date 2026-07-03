// Writing failing test first.
//
// Spec 233 / ADR 0067 U3 — the project-page client-invite + revoke actions.
// The issuer gate is PD + super ONLY (CLIENT_ISSUER_ROLES). The action does a
// friendly early role check (defense-in-depth; the definer RPC gates again) and
// relays through the RLS session — never the admin client.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const single = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    rpc,
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createClientInvite,
  grantClientAccess,
  revokeClientAccess,
  updateClientAccessTier,
} from "@/app/projects/[projectId]/actions";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ACCESS = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  getUser.mockReset();
  single.mockReset();
  rpc.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
});

describe("createClientInvite", () => {
  it("rejects a project_manager — the issuer gate is PD + super only", async () => {
    single.mockResolvedValue({ data: { role: "project_manager" } });
    const r = await createClientInvite({ projectId: PROJECT, validUntil: "2026-12-31" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a project_director gets { ok: true, token }", async () => {
    single.mockResolvedValue({ data: { role: "project_director" } });
    rpc.mockResolvedValue({ data: "tok-abc", error: null });
    const r = await createClientInvite({ projectId: PROJECT, validUntil: "2026-12-31" });
    expect(r).toEqual({ ok: true, token: "tok-abc" });
    expect(rpc).toHaveBeenCalledWith(
      "create_client_invite",
      expect.objectContaining({ p_project: PROJECT }),
    );
  });

  it("rejects a malformed valid-until date before calling the RPC", async () => {
    single.mockResolvedValue({ data: { role: "project_director" } });
    const r = await createClientInvite({ projectId: PROJECT, validUntil: "not-a-date" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("defaults p_tier to basic when tier is omitted", async () => {
    single.mockResolvedValue({ data: { role: "project_director" } });
    rpc.mockResolvedValue({ data: "tok-abc", error: null });
    await createClientInvite({ projectId: PROJECT, validUntil: "2026-12-31" });
    expect(rpc).toHaveBeenCalledWith(
      "create_client_invite",
      expect.objectContaining({ p_tier: "basic" }),
    );
  });

  it("passes p_tier=full through when the caller picks full", async () => {
    single.mockResolvedValue({ data: { role: "project_director" } });
    rpc.mockResolvedValue({ data: "tok-abc", error: null });
    await createClientInvite({ projectId: PROJECT, validUntil: "2026-12-31", tier: "full" });
    expect(rpc).toHaveBeenCalledWith(
      "create_client_invite",
      expect.objectContaining({ p_tier: "full" }),
    );
  });
});

describe("revokeClientAccess", () => {
  it("rejects a project_manager", async () => {
    single.mockResolvedValue({ data: { role: "project_manager" } });
    const r = await revokeClientAccess({ accessId: ACCESS, projectId: PROJECT });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a project_director revokes → { ok: true }", async () => {
    single.mockResolvedValue({ data: { role: "project_director" } });
    rpc.mockResolvedValue({ error: null });
    const r = await revokeClientAccess({ accessId: ACCESS, projectId: PROJECT });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("revoke_client_access", { p_access_id: ACCESS });
  });
});

describe("updateClientAccessTier (spec 254)", () => {
  it("rejects a project_manager — the issuer gate is PD + super only", async () => {
    single.mockResolvedValue({ data: { role: "project_manager" } });
    const r = await updateClientAccessTier({ accessId: ACCESS, projectId: PROJECT, tier: "full" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a project_director upgrades the tier → { ok: true }", async () => {
    single.mockResolvedValue({ data: { role: "project_director" } });
    rpc.mockResolvedValue({ error: null });
    const r = await updateClientAccessTier({ accessId: ACCESS, projectId: PROJECT, tier: "full" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_client_access_tier", {
      p_access_id: ACCESS,
      p_tier: "full",
    });
  });
});

describe("grantClientAccess (spec 234 U3)", () => {
  it("rejects a project_manager — the issuer gate is PD + super only", async () => {
    single.mockResolvedValue({ data: { role: "project_manager" } });
    const r = await grantClientAccess({
      userId: USER,
      projectId: PROJECT,
      validUntil: "2026-12-31",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a project_director relays to grant_client_access → { ok: true }", async () => {
    single.mockResolvedValue({ data: { role: "project_director" } });
    rpc.mockResolvedValue({ error: null });
    const r = await grantClientAccess({
      userId: USER,
      projectId: PROJECT,
      validUntil: "2026-12-31",
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith(
      "grant_client_access",
      expect.objectContaining({ p_user_id: USER, p_project: PROJECT }),
    );
  });

  it("rejects a malformed valid-until date before the RPC", async () => {
    single.mockResolvedValue({ data: { role: "project_director" } });
    const r = await grantClientAccess({ userId: USER, projectId: PROJECT, validUntil: "nope" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
