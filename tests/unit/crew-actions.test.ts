// Spec 330 U3b — crew manage server actions: shape validation, the RPC relay,
// and the Thai error map. Authorization is the DB's (the RPCs are SECURITY
// DEFINER gating on is_back_office), exactly as spec 306's muster actions do —
// these tests pin the relay contract, not a role gate.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockGetActionUser, mockRevalidate } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetActionUser: vi.fn(),
  mockRevalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser: mockGetActionUser,
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
}));

import {
  addWorkerToCrew,
  createCrew,
  dissolveCrew,
  moveWorkerBetweenCrews,
  removeWorkerFromCrew,
  renameCrew,
  setCrewLead,
} from "@/lib/team-map/crew-actions";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const CREW = "22222222-2222-4222-8222-222222222222";
const CREW_B = "33333333-3333-4333-8333-333333333333";
const WORKER = "44444444-4444-4444-8444-444444444444";
const REVALIDATE = `/projects/${PROJECT}/team`;

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: "ok-id", error: null });
  mockRevalidate.mockReset();
  mockGetActionUser.mockReset().mockResolvedValue({
    supabase: { rpc: mockRpc },
    user: { id: "u-1" },
  });
});

describe("crew actions — relay + revalidate", () => {
  it("addWorkerToCrew relays p_crew/p_worker and revalidates the team page", async () => {
    const r = await addWorkerToCrew({ crewId: CREW, workerId: WORKER, revalidate: REVALIDATE });
    expect(r).toEqual({ ok: true, id: "ok-id" });
    expect(mockRpc).toHaveBeenCalledWith("add_worker_to_crew", {
      p_crew: CREW,
      p_worker: WORKER,
    });
    expect(mockRevalidate).toHaveBeenCalledWith(REVALIDATE);
  });

  it("moveWorkerBetweenCrews relays all three params", async () => {
    await moveWorkerBetweenCrews({
      fromCrewId: CREW,
      toCrewId: CREW_B,
      workerId: WORKER,
      revalidate: REVALIDATE,
    });
    expect(mockRpc).toHaveBeenCalledWith("move_worker_between_crews", {
      p_from: CREW,
      p_to: CREW_B,
      p_worker: WORKER,
    });
  });

  it("removeWorkerFromCrew / setCrewLead / dissolveCrew relay their RPCs", async () => {
    await removeWorkerFromCrew({ crewId: CREW, workerId: WORKER, revalidate: REVALIDATE });
    expect(mockRpc).toHaveBeenCalledWith("remove_worker_from_crew", {
      p_crew: CREW,
      p_worker: WORKER,
    });
    await setCrewLead({ crewId: CREW, workerId: WORKER, revalidate: REVALIDATE });
    expect(mockRpc).toHaveBeenCalledWith("set_crew_lead", { p_crew: CREW, p_worker: WORKER });
    await dissolveCrew({ crewId: CREW, revalidate: REVALIDATE });
    expect(mockRpc).toHaveBeenCalledWith("dissolve_crew", { p_crew: CREW });
  });

  it("createCrew relays the project + trimmed name", async () => {
    await createCrew({ projectId: PROJECT, name: "  ทีมปูน  ", revalidate: REVALIDATE });
    expect(mockRpc).toHaveBeenCalledWith("create_crew", {
      p_project: PROJECT,
      p_name: "ทีมปูน",
    });
  });

  it("renameCrew relays the trimmed name", async () => {
    await renameCrew({ crewId: CREW, name: " ทีมใหม่ ", revalidate: REVALIDATE });
    expect(mockRpc).toHaveBeenCalledWith("rename_crew", { p_crew: CREW, p_name: "ทีมใหม่" });
  });
});

describe("crew actions — shape validation happens BEFORE the auth gate", () => {
  it("rejects a malformed uuid without touching the RPC", async () => {
    const r = await addWorkerToCrew({ crewId: "nope", workerId: WORKER, revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockGetActionUser).not.toHaveBeenCalled();
  });

  it("rejects a blank crew name without touching the RPC", async () => {
    const r = await createCrew({ projectId: PROJECT, name: "   ", revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects an over-long crew name (the DB check would 23514)", async () => {
    const r = await renameCrew({ crewId: CREW, name: "ก".repeat(200), revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a revalidate path that is not app-internal", async () => {
    const r = await dissolveCrew({ crewId: CREW, revalidate: "https://evil.example" });
    expect(r.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns NOT_SIGNED_IN when there is no session", async () => {
    mockGetActionUser.mockResolvedValue(null);
    const r = await addWorkerToCrew({ crewId: CREW, workerId: WORKER, revalidate: REVALIDATE });
    expect(r).toEqual({ ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" });
  });
});

describe("crew actions — Thai error map (message-keyed, per the muster precedent)", () => {
  const cases: [string, string][] = [
    // The spec 330 U3a money wall — the one a PM will actually hit.
    ["contractor-tied worker is pay-exempt and cannot join a crew", "ช่างของผู้รับเหมา"],
    ["contractor-tied worker is pay-exempt and cannot lead a crew", "ช่างของผู้รับเหมา"],
    ["not authorized to manage crew members", "ไม่มีสิทธิ์"],
    ["crew is dissolved", "ทีมนี้ถูกยุบแล้ว"],
    ["worker not found or inactive", "ไม่พบช่าง"],
    ["worker belongs to another project", "ช่างอยู่คนละโครงการ"],
    ["worker is not an active member of the source crew", "ช่างไม่ได้อยู่ในทีมต้นทาง"],
    ["lead must be an active member of the crew", "หัวหน้าทีมต้องเป็นสมาชิกของทีม"],
    ["crew name must not be blank", "ต้องตั้งชื่อทีม"],
    ["concurrent crew-membership change for this worker", "มีการแก้ไขพร้อมกัน"],
    ["crew not found", "ไม่พบทีม"],
  ];

  it.each(cases)("maps %s → Thai containing %s", async (dbMessage, thaiFragment) => {
    mockRpc.mockResolvedValue({ data: null, error: { message: dbMessage, code: "22023" } });
    const r = await addWorkerToCrew({ crewId: CREW, workerId: WORKER, revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(thaiFragment);
  });

  it("falls back to a generic Thai message for an unmapped error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom", code: "XX000" } });
    const r = await addWorkerToCrew({ crewId: CREW, workerId: WORKER, revalidate: REVALIDATE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ไม่สำเร็จ/);
  });

  it("does not revalidate when the RPC failed", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "crew not found", code: "P0002" } });
    await addWorkerToCrew({ crewId: CREW, workerId: WORKER, revalidate: REVALIDATE });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});
