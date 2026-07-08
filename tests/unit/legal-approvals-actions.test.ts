// Writing failing test first.
//
// Spec 284 U4 — the Legal document-decision server action relays the
// submit_document_decision RPC on requireActionRole(DOC_APPROVAL_ROLES). The RPC is
// SECURITY DEFINER gating the AUTHED session's role, so the action calls it on
// requireActionRole().auth.supabase (NEVER the admin client — a service-role null
// role would 42501 the gate). The role/session gate + the rpc are mocked: this pins
// the wiring (role gate short-circuits before the RPC, and the arg mapping), not the DB.

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

import { submitDocumentDecision } from "@/lib/legal/approvals";

beforeEach(() => {
  requireActionRole.mockReset().mockResolvedValue({
    auth: { supabase: { rpc }, user: { id: "legal-1" } },
  });
  rpc.mockReset().mockResolvedValue({ data: "approval-1", error: null });
});

describe("submitDocumentDecision — spec 284 U4", () => {
  it("relays submit_document_decision with the mapped args and returns the new id", async () => {
    const r = await submitDocumentDecision({
      contractId: "aa000000-0284-4000-8000-aa0000000284",
      decision: "approve",
      comment: "looks good",
    });
    expect(r).toEqual({ ok: true, id: "approval-1" });
    expect(rpc).toHaveBeenCalledWith("submit_document_decision", {
      p_contract_id: "aa000000-0284-4000-8000-aa0000000284",
      p_decision: "approve",
      p_comment: "looks good",
    });
  });

  it("gates on DOC_APPROVAL_ROLES — a rejected caller never reaches the RPC", async () => {
    requireActionRole.mockResolvedValueOnce({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await submitDocumentDecision({
      contractId: "aa000000-0284-4000-8000-aa0000000284",
      decision: "approve",
      comment: "looks good",
    });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("relays a reject decision (approve is not the only path)", async () => {
    await submitDocumentDecision({
      contractId: "bb000000-0284-4000-8000-bb0000000284",
      decision: "reject",
      comment: "missing signature",
    });
    expect(rpc).toHaveBeenCalledWith("submit_document_decision", {
      p_contract_id: "bb000000-0284-4000-8000-bb0000000284",
      p_decision: "reject",
      p_comment: "missing signature",
    });
  });

  it("surfaces a generic error when the RPC fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const r = await submitDocumentDecision({
      contractId: "aa000000-0284-4000-8000-aa0000000284",
      decision: "needs_revision",
      comment: "please revise",
    });
    expect(r.ok).toBe(false);
  });
});
