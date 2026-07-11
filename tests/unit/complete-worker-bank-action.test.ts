// Writing failing test first.
//
// Spec 298 U3 — completeWorkerBank: a money-authorized approver (the page gated
// STAFF_APPROVAL_ROLES; the RPC re-gates) transcribes the SA-captured passbook into
// workers.bank_* via the complete_worker_bank DEFINER RPC (validates + normalizes the
// account number, flips the capture to on_file, never touches pay/level). This action
// relays + maps errors to Thai. Session/rpc mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc } = vi.hoisted(() => ({ getActionUser: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { completeWorkerBank } from "@/app/registrations/awaiting-bank/actions";

const WORKER = "55555555-5555-4555-8555-555555555555";
const GOOD = {
  workerId: WORKER,
  bankName: " ธนาคารกรุงเทพ ",
  accountNumber: "123-456 789",
  accountName: " สมชาย ช่างดี ",
};

beforeEach(() => {
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc }, user: { id: "pm-1" } });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("completeWorkerBank — spec 298 U3", () => {
  it("relays trimmed fields to complete_worker_bank and returns ok", async () => {
    const r = await completeWorkerBank(GOOD);
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("complete_worker_bank", {
      p_worker_id: WORKER,
      p_bank_name: "ธนาคารกรุงเทพ",
      p_account_number: "123-456 789", // the RPC normalizes; the action passes as-typed
      p_account_name: "สมชาย ช่างดี",
    });
  });

  it("maps the no-pending-capture RPC error to Thai", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "complete_worker_bank: no pending bank capture for this worker" },
    });
    const r = await completeWorkerBank(GOOD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/รอกรอกบัญชี/);
  });

  it("maps the bad-account-number RPC error to Thai", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "complete_worker_bank: account number must be 6-20 digits" },
    });
    const r = await completeWorkerBank(GOOD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/6-20/);
  });

  it("rejects an empty bank name before the RPC", async () => {
    const r = await completeWorkerBank({ ...GOOD, bankName: "   " });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
