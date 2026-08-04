// Writing failing test first.
//
// Honest-copy mapping for createWorker (feedback e6b48386 — /workers add ช่าง).
// A procurement user saw "บันทึกช่างไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" during a deploy
// that briefly unresolved her session: create_worker's role gate raised 42501, and
// the action collapsed every cause — bad rate, lost session, transient blip — into
// one generic "try again". A permanent/actionable cause must say what to do; only a
// genuine transient keeps "ลองใหม่".
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createWorker, updateWorker, setWorkerDayRate } from "@/app/workers/actions";
import {
  GENERIC_ERROR,
  SESSION_LOST_ERROR,
  INVALID_NAME_ERROR,
  INVALID_RATE_ERROR,
  DUPLICATE_TAX_ID_ERROR,
  DUPLICATE_GENERIC_ERROR,
} from "@/app/workers/error-copy";

const WORKER_ID = "11111111-1111-4111-8111-111111111111";

const BASE = {
  name: "นางพิศสมัย ฮามศรีพรม",
  workerType: "dc" as const,
  employmentType: "permanent" as const,
  dayRate: 412.37,
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: "worker-uuid", error: null });
});

describe("createWorker — honest error copy", () => {
  it("names the rate field when the day rate is not a valid number (the -1 the form sends)", async () => {
    const r = await createWorker({ ...BASE, dayRate: -1 });
    expect(r).toEqual({ ok: false, error: INVALID_RATE_ERROR });
    expect(r).not.toEqual({ ok: false, error: GENERIC_ERROR });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names the name field when the name is blank", async () => {
    const r = await createWorker({ ...BASE, name: "   " });
    expect(r).toEqual({ ok: false, error: INVALID_NAME_ERROR });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a 42501 from create_worker to a session-expired message, not a retry", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "create_worker: role not permitted" },
    });
    const r = await createWorker(BASE);
    expect(r).toEqual({ ok: false, error: SESSION_LOST_ERROR });
    expect(SESSION_LOST_ERROR).not.toBe(GENERIC_ERROR);
  });

  it("keeps the generic retry copy for an unknown RPC error", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "serialization failure" },
    });
    const r = await createWorker(BASE);
    expect(r).toEqual({ ok: false, error: GENERIC_ERROR });
  });

  it("still succeeds on a clean create", async () => {
    const r = await createWorker(BASE);
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith(
      "create_worker",
      expect.objectContaining({ p_name: BASE.name }),
    );
  });

  // Class fix: the same session-lost mapping covers the sibling roster RPC actions,
  // not just create — a 42501 anywhere in the roster means re-auth, not retry.
  it("maps 42501 to the session message in updateWorker", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "update_worker: role not permitted" },
    });
    expect(await updateWorker({ id: WORKER_ID, note: "x" })).toEqual({
      ok: false,
      error: SESSION_LOST_ERROR,
    });
  });

  // Field incident 2026-08-04 (/workers, 14:35 BKK): a procurement user re-added a
  // ช่าง who was already on the roster and got the generic retry. The refusal came
  // from `workers_tax_id_unique` (23505, proved live) — a PERMANENT refusal that
  // "ลองใหม่อีกครั้ง" invites her to repeat forever, and which named neither the
  // cause nor the person she had collided with.
  it("maps a duplicate เลขบัตรประชาชน (23505 on workers_tax_id_unique) to a permanent refusal", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "workers_tax_id_unique"',
        details: "Key (tax_id)=(1160400054920) already exists.",
      },
    });
    const r = await createWorker({ ...BASE, taxId: "1160400054920" });
    expect(r).toEqual({ ok: false, error: DUPLICATE_TAX_ID_ERROR });
    // Honest copy: retrying can never succeed, so it must not ask for a retry.
    expect(DUPLICATE_TAX_ID_ERROR).not.toContain("ลองใหม่");
    expect(DUPLICATE_TAX_ID_ERROR).not.toBe(GENERIC_ERROR);
  });

  it("maps any other unique violation to duplicate copy — never the retry", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "workers_employee_id_unique"',
      },
    });
    const r = await createWorker(BASE);
    expect(r).toEqual({ ok: false, error: DUPLICATE_GENERIC_ERROR });
    expect(DUPLICATE_GENERIC_ERROR).not.toContain("ลองใหม่");
  });

  // The edit sheet writes tax_id too (DC edit matrix), so it can collide the same way.
  it("maps the duplicate เลขบัตรประชาชน in updateWorker as well", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "workers_tax_id_unique"',
      },
    });
    expect(await updateWorker({ id: WORKER_ID, taxId: "1160400054920" })).toEqual({
      ok: false,
      error: DUPLICATE_TAX_ID_ERROR,
    });
  });

  it("maps 42501 to the session message in setWorkerDayRate", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "set_worker_day_rate: role not permitted" },
    });
    expect(await setWorkerDayRate({ id: WORKER_ID, dayRate: 400 })).toEqual({
      ok: false,
      error: SESSION_LOST_ERROR,
    });
  });
});
