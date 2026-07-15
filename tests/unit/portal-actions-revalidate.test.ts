// Spec 321 S14 — portal self-service actions revalidate the surface the caller
// actually reads. A bound ช่าง (worker) reads their profile at /technician, so
// worker-scoped writes must revalidate /technician (not /portal, where a
// contractor reads — a stale-cache no-op for the worker, S14). revokeOwnConsent
// is SHARED (revoke_contractor_consent now admits the bound worker too), so it
// revalidates BOTH surfaces. Contractor-only writes keep revalidating /portal.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc, revalidatePath } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({ getActionUser, NOT_SIGNED_IN: "not signed in" }));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  recordOwnConsent,
  recordOwnWorkerConsent,
  revokeOwnConsent,
  updateOwnWorkerProfile,
} from "@/lib/portal/actions";

const UUID = "11111111-1111-4111-8111-111111111111";
const CONTRACTOR = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ error: null });
  revalidatePath.mockReset();
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc }, user: { id: "u1" } });
});

describe("portal self-service revalidation targets the caller's read surface (S14)", () => {
  it("updateOwnWorkerProfile revalidates /technician, not /portal", async () => {
    const r = await updateOwnWorkerProfile({
      phone: "",
      email: "",
      emergencyName: "",
      emergencyRelation: "",
      emergencyPhone: "",
    });
    expect(r).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/technician");
    expect(revalidatePath).not.toHaveBeenCalledWith("/portal");
  });

  it("recordOwnWorkerConsent revalidates /technician, not /portal", async () => {
    const r = await recordOwnWorkerConsent({ kind: "pdpa_data" });
    expect(r).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/technician");
    expect(revalidatePath).not.toHaveBeenCalledWith("/portal");
  });

  it("revokeOwnConsent is shared (worker + contractor) → revalidates BOTH surfaces", async () => {
    const r = await revokeOwnConsent({ id: UUID });
    expect(r).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/technician");
    expect(revalidatePath).toHaveBeenCalledWith("/portal");
  });

  it("recordOwnConsent stays contractor-scoped → keeps revalidating /portal only", async () => {
    const r = await recordOwnConsent({ contractorId: CONTRACTOR, kind: "pdpa_data" });
    expect(r).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith("/portal");
    expect(revalidatePath).not.toHaveBeenCalledWith("/technician");
  });
});
