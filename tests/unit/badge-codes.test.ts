// Spec 306 U1 — the badge sheet's service-role read of workers.employee_id.
// The column is walled to service_role (workers PII wall), so this ONE read
// crosses the admin boundary for worker ids the caller's RLS session already
// authorized (same exposure model as spec 296 U3 registration-bank). These
// tests pin the seam: only id+employee_id selected, empty input never touches
// the client, errors throw. The admin client is mocked at the module boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));

vi.mock("@/lib/db/admin", () => ({
  createClient: mockCreateClient,
}));

import { fetchWorkerBadgeCodes } from "@/lib/sa/badge-codes";

function clientReturning(result: { data: unknown; error: unknown }) {
  const inFn = vi.fn().mockResolvedValue(result);
  const selectFn = vi.fn().mockReturnValue({ in: inFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });
  return { client: { from: fromFn }, fromFn, selectFn, inFn };
}

describe("fetchWorkerBadgeCodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects ONLY id and employee_id, scoped to the given worker ids", async () => {
    const { client, fromFn, selectFn, inFn } = clientReturning({
      data: [
        { id: "w1", employee_id: "PRC-26-0002" },
        { id: "w2", employee_id: null },
      ],
      error: null,
    });
    mockCreateClient.mockReturnValue(client);

    const map = await fetchWorkerBadgeCodes(["w1", "w2"]);
    expect(fromFn).toHaveBeenCalledWith("workers");
    expect(selectFn).toHaveBeenCalledWith("id, employee_id");
    expect(inFn).toHaveBeenCalledWith("id", ["w1", "w2"]);
    expect(map.get("w1")).toBe("PRC-26-0002");
    expect(map.has("w2")).toBe(false);
  });

  it("short-circuits on empty input without creating the admin client", async () => {
    const map = await fetchWorkerBadgeCodes([]);
    expect(map.size).toBe(0);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("throws on a query error", async () => {
    const { client } = clientReturning({ data: null, error: { message: "boom" } });
    mockCreateClient.mockReturnValue(client);
    await expect(fetchWorkerBadgeCodes(["w1"])).rejects.toThrow(/badge-codes: boom/);
  });
});
