// Writing failing test first.
//
// DC edit matrix — updateWorker forwards the pay_type × employment_type matrix +
// payee fields (phone, tax_id, bank) to the already-capable update_worker RPC
// (spec 266 gave the RPC these params; the action just relayed name/active/note).
// The RPC gates itself (is_back_office) and coalesce-preserves omitted fields; the
// action validates shape and relays. Bank is UI-gated to UNBOUND workers in the
// roster manager — the action forwards whatever it is handed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateWorker } from "@/app/workers/actions";

const WORKER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("updateWorker — DC edit matrix forwarding", () => {
  it("forwards pay_type, employment_type, phone, tax_id and bank with the exact RPC shape", async () => {
    const r = await updateWorker({
      id: WORKER,
      payType: "daily",
      employmentType: "temporary",
      phone: "0812345678",
      taxId: "1234567890123",
      bankName: "กสิกรไทย",
      bankAccountNumber: "1112223334",
      bankAccountName: "สมชาย ใจดี",
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("update_worker", {
      p_id: WORKER,
      p_pay_type: "daily",
      p_employment_type: "temporary",
      p_phone: "0812345678",
      p_tax_id: "1234567890123",
      p_bank_name: "กสิกรไทย",
      p_bank_account_number: "1112223334",
      p_bank_account_name: "สมชาย ใจดี",
    });
  });

  it("omits params that are not provided (RPC coalesce-preserves them)", async () => {
    await updateWorker({ id: WORKER, phone: "0899999999" });
    expect(rpc).toHaveBeenCalledWith("update_worker", { p_id: WORKER, p_phone: "0899999999" });
  });

  // Spec 328 firm move — contractorId forwards as p_contractor (set/change only;
  // the RPC coalesce cannot clear, so the action never sends an empty value).
  it("forwards contractorId as p_contractor", async () => {
    const FIRM = "22222222-2222-4222-8222-222222222222";
    await updateWorker({ id: WORKER, contractorId: FIRM });
    expect(rpc).toHaveBeenCalledWith("update_worker", { p_id: WORKER, p_contractor: FIRM });
  });

  it("rejects a malformed contractorId before any RPC", async () => {
    const r = await updateWorker({ id: WORKER, contractorId: "not-a-uuid" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid pay_type before any RPC", async () => {
    const r = await updateWorker({ id: WORKER, payType: "weekly" as never });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid employment_type before any RPC", async () => {
    const r = await updateWorker({ id: WORKER, employmentType: "seasonal" as never });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an RPC error to the generic Thai error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "42501" } });
    const r = await updateWorker({ id: WORKER, payType: "monthly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ไม่สำเร็จ/);
  });
});
