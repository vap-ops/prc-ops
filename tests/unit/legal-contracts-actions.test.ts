// Writing failing test first.
//
// Spec 284 U3 — the Legal contract server actions relay the create_/update_/
// void_contract + add_contract_attachment RPCs on requireActionRole(LEGAL_ROLES).
// The RPCs are SECURITY DEFINER gating the AUTHED session's role, so the action
// calls them on requireActionRole().auth.supabase (never the admin client — a
// service-role null role would 42501 the gate). The role/session gate + the rpc
// are mocked: this pins the wiring (role gate short-circuits before the RPC, and
// the arg mapping), not the DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, rpc } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  requireActionRole,
  getActionUser: vi.fn(),
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
  NOT_PERMITTED: "ไม่มีสิทธิ์ทำรายการนี้",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import {
  createContract,
  updateContract,
  voidContract,
  addContractAttachment,
} from "@/lib/legal/contracts";

beforeEach(() => {
  requireActionRole.mockReset().mockResolvedValue({
    auth: { supabase: { rpc }, user: { id: "legal-1" } },
  });
  rpc.mockReset().mockResolvedValue({ data: "contract-1", error: null });
});

describe("createContract — spec 284 U3", () => {
  it("relays create_contract with the mapped args and returns the new id", async () => {
    const r = await createContract({
      counterpartyType: "client",
      counterpartyName: "ACME Co",
      contractType: "client_agreement",
      title: "Master Services Agreement",
      agreedAmount: 250000,
    });
    expect(r).toEqual({ ok: true, id: "contract-1" });
    expect(rpc).toHaveBeenCalledWith("create_contract", {
      p_counterparty_type: "client",
      p_counterparty_name: "ACME Co",
      p_contract_type: "client_agreement",
      p_title: "Master Services Agreement",
      p_agreed_amount: 250000,
    });
  });

  it("gates on LEGAL_ROLES — a rejected caller never reaches the RPC", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await createContract({
      counterpartyType: "client",
      counterpartyName: "ACME Co",
      contractType: "client_agreement",
      title: "MSA",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("omits optional args (project/amount) rather than passing undefined", async () => {
    await createContract({
      counterpartyType: "other",
      counterpartyName: "N/A",
      contractType: "nda",
      title: "Mutual NDA",
    });
    expect(rpc).toHaveBeenCalledWith("create_contract", {
      p_counterparty_type: "other",
      p_counterparty_name: "N/A",
      p_contract_type: "nda",
      p_title: "Mutual NDA",
    });
  });
});

describe("voidContract — spec 284 U3", () => {
  it("relays void_contract with p_id", async () => {
    const r = await voidContract("cc000000-0284-4000-8000-cc0000000284");
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("void_contract", {
      p_id: "cc000000-0284-4000-8000-cc0000000284",
    });
  });

  it("gates before the RPC", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await voidContract("cc000000-0284-4000-8000-cc0000000284");
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("updateContract — spec 284 U3", () => {
  it("relays update_contract, omitting unset fields", async () => {
    const r = await updateContract({ id: "c-1", status: "active", signDate: "2026-07-09" });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("update_contract", {
      p_id: "c-1",
      p_status: "active",
      p_sign_date: "2026-07-09",
    });
  });
});

describe("addContractAttachment — spec 284 U3", () => {
  it("relays add_contract_attachment and returns the new id", async () => {
    const r = await addContractAttachment({
      contractId: "c-1",
      storagePath: "legal/contracts/c-1/deed.pdf",
    });
    expect(r).toEqual({ ok: true, id: "contract-1" });
    expect(rpc).toHaveBeenCalledWith("add_contract_attachment", {
      p_contract_id: "c-1",
      p_storage_path: "legal/contracts/c-1/deed.pdf",
    });
  });

  it("gates before the RPC", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await addContractAttachment({ contractId: "c-1", storagePath: "x.pdf" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
