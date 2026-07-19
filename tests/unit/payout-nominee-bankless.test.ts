// Writing failing test first.
//
// Spec 328 U3 — money-wall leak closure on the spec-320 nominee picker:
// listBanklessWorkers() must exclude contractor-tied workers
// (`contractor_id IS NULL`). A subcon member (workers.contractor_id set,
// pay-exempt — firm pays them, PRC never does) has bank_account_number NULL
// forever, so without this filter they'd surface in the payout-nominee picker
// and a nominee payout could be routed for someone PRC never pays. The admin
// client is mocked at the module boundary; this pins the query shape.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));

vi.mock("@/lib/db/admin", () => ({
  createClient: mockCreateClient,
}));

import { listBanklessWorkers } from "@/lib/payroll/payout-nominee";

function chainClient(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args]);
      return chain;
    });
  }
  chain.order = vi.fn((...args: unknown[]) => {
    calls.push(["order", args]);
    return Promise.resolve(result);
  });
  const fromFn = vi.fn().mockReturnValue(chain);
  return { client: { from: fromFn }, fromFn, calls };
}

describe("listBanklessWorkers — contractor-member wall (spec 328 U3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters to contractor_id IS NULL in addition to active + bankless", async () => {
    const { client, fromFn, calls } = chainClient({
      data: [{ id: "w1", name: "ช่างหนึ่ง", employee_id: "PRC-001" }],
      error: null,
    });
    mockCreateClient.mockReturnValue(client);

    const rows = await listBanklessWorkers();

    expect(fromFn).toHaveBeenCalledWith("workers");
    expect(calls).toContainEqual(["eq", ["active", true]]);
    expect(calls).toContainEqual(["is", ["bank_account_number", null]]);
    expect(calls).toContainEqual(["is", ["contractor_id", null]]);
    expect(rows).toEqual([{ id: "w1", name: "ช่างหนึ่ง", code: "PRC-001" }]);
  });
});
