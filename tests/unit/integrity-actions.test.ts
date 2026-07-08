// Writing failing test first.
//
// Spec 283 U1 — the "run now" server action (runIntegrityNow). It re-guards
// super_admin at the TS layer (defense-in-depth; the RPC is definer-gated too),
// then relays through the RLS session client to run_and_record_integrity and
// refreshes the console. Tests pin: a non-super role is bounced before any RPC;
// super_admin calls the RPC and revalidates the board.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireRole, rpc, revalidatePath } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/db/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { runIntegrityNow } from "@/app/settings/integrity/actions";

beforeEach(() => {
  requireRole.mockReset().mockResolvedValue({ id: "u1", role: "super_admin", fullName: null });
  rpc.mockReset().mockResolvedValue({ data: "run-1", error: null });
  revalidatePath.mockReset();
});

describe("runIntegrityNow (spec 283 U1)", () => {
  it("bounces a non-super role before any RPC", async () => {
    requireRole.mockImplementation(() => {
      throw new Error("__redirect__");
    });
    await expect(runIntegrityNow()).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("guards on super_admin exactly", async () => {
    await runIntegrityNow();
    expect(requireRole).toHaveBeenCalledWith(["super_admin"]);
  });

  it("records a manual run then revalidates the board", async () => {
    await runIntegrityNow();
    expect(rpc).toHaveBeenCalledWith("run_and_record_integrity");
    expect(revalidatePath).toHaveBeenCalledWith("/settings/integrity");
  });
});
