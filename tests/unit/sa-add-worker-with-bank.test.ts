// Writing failing test first.
//
// Spec 298 U2 — addProjectWorkerWithBank: the no-phone add that carries a walled
// passbook photo path. The client uploads the photo to sa-bank-capture/… first,
// then this action forwards {identity + photoPath} to the DEFINER RPC
// sa_add_project_worker_with_bank. Validates shape (uuid project, 13-digit id, dob,
// a sa-bank-capture/ photo path) and maps the RPC's errors to Thai. Session/rpc
// mocked — this pins the wiring + the new "passbook required" mapping.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc } = vi.hoisted(() => ({ getActionUser: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { addProjectWorkerWithBank } from "@/app/sa/crew/actions";

const PROJECT = "44444444-4444-4444-8444-444444444444";
const GOOD = {
  projectId: PROJECT,
  name: "สมชาย ช่างดี",
  nationalId: "3201200000008",
  dob: "1990-05-01",
  photoPath: "sa-bank-capture/2026/11111111-1111-1111-1111-111111111111.jpg",
};

beforeEach(() => {
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc }, user: { id: "sa-1" } });
  rpc.mockReset().mockResolvedValue({ data: "worker-uuid", error: null });
});

describe("addProjectWorkerWithBank — spec 298 U2", () => {
  it("forwards identity + photo path to sa_add_project_worker_with_bank on success", async () => {
    const r = await addProjectWorkerWithBank(GOOD);
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("sa_add_project_worker_with_bank", {
      p_project: PROJECT,
      p_name: "สมชาย ช่างดี",
      p_national_id: "3201200000008",
      p_dob: "1990-05-01",
      p_photo_path: GOOD.photoPath,
    });
  });

  it("rejects a non-uuid project without calling the RPC", async () => {
    const r = await addProjectWorkerWithBank({ ...GOOD, projectId: "nope" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a non-13-digit national id without calling the RPC", async () => {
    const r = await addProjectWorkerWithBank({ ...GOOD, nationalId: "123" });
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a sa-bank-capture/ photo path (never sends a bad one)", async () => {
    const missing = await addProjectWorkerWithBank({ ...GOOD, photoPath: "" });
    expect(missing.ok).toBe(false);
    const wrong = await addProjectWorkerWithBank({
      ...GOOD,
      photoPath: "technician/x/book_bank/y.jpg",
    });
    expect(wrong.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a duplicate-national-id RPC error to Thai", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: "sa_add_project_worker_with_bank: this national-ID is already on a worker",
      },
    });
    const r = await addProjectWorkerWithBank(GOOD);
    expect(r).toEqual({ ok: false, error: "เลขบัตรนี้มีอยู่แล้วในระบบ" });
  });
});
