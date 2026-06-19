// Spec 147 U4 — the DC-portal loader batches its independent queries. RED first:
// asserts the fan runs CONCURRENTLY (max in-flight >= 6; a serial waterfall would
// peak at 1) and assembles the right shape. own-documents (RLS-scoped read +
// signed URLs) is stubbed so the test isolates the loader's orchestration.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getDocsMock } = vi.hoisted(() => ({ getDocsMock: vi.fn() }));
vi.mock("@/lib/portal/own-documents", () => ({ getOwnContractorDocuments: getDocsMock }));

import { loadPortalData } from "@/lib/portal/load-portal-data";

let inFlight = 0;
let maxInFlight = 0;

const PROFILE = { id: "c1", name: "ช่างเอ", phone: "08", contractor_subtype: "subcon_member" };
const CONSENTS = [{ id: "cs1", kind: "pdpa_data", consented_at: "2026-06-01", revoked_at: null }];
const CREW = [{ id: "w1", name: "ลูกทีม", active: true }];
const PAYMENTS = [
  { id: "pay1", period_from: "2026-06-01", period_to: "2026-06-07", paid_amount: 5000, paid_at: "2026-06-08", method: "bank_transfer" },
];
const PENDING = { id: "bc1" };

let singleContractors: unknown = PROFILE;
const SINGLE = (): Record<string, unknown> => ({
  contractors: singleContractors,
  contractor_bank_change_requests: PENDING,
});
const LIST: Record<string, unknown[]> = {
  contractor_consents: CONSENTS,
  workers: CREW,
};
const RPC: Record<string, unknown> = {
  get_my_dc_payments: PAYMENTS,
  my_contact_bank_present: true,
};

function track<T>(value: T): Promise<T> {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  return new Promise((r) => setTimeout(r, 5)).then(() => {
    inFlight--;
    return value;
  });
}

function makeQuery(table: string) {
  const q: Record<string, unknown> = { __single: false };
  for (const m of ["select", "eq", "neq", "in", "order", "limit"]) {
    q[m] = () => q;
  }
  q.maybeSingle = () => {
    q.__single = true;
    return q;
  };
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    track({ data: q.__single ? SINGLE()[table] : (LIST[table] ?? []), error: null }).then(
      resolve,
      reject,
    );
  return q;
}

const supabase = {
  from: (table: string) => makeQuery(table),
  rpc: (name: string) => track({ data: RPC[name] ?? null, error: null }),
} as never;

beforeEach(() => {
  inFlight = 0;
  maxInFlight = 0;
  singleContractors = PROFILE;
  getDocsMock.mockReset().mockResolvedValue({ present: new Set(["id_card"]), urls: new Map() });
});

describe("loadPortalData", () => {
  it("runs the independent fan concurrently (not a serial waterfall)", async () => {
    await loadPortalData(supabase);
    // contractors + consents + workers + payments-rpc + pendingChange +
    // bank-present-rpc = 6 reads, all RLS-scoped to self → must overlap.
    expect(maxInFlight).toBeGreaterThanOrEqual(6);
  });

  it("assembles the correct shape", async () => {
    const data = await loadPortalData(supabase);
    expect(data.profile).toEqual(PROFILE);
    expect(data.consentRows).toEqual(CONSENTS);
    expect(data.crew).toEqual(CREW);
    expect(data.payments).toEqual(PAYMENTS);
    expect(data.pendingChange).toEqual(PENDING);
    expect(data.bankPresent).toBe(true);
    expect(data.docs?.present.has("id_card")).toBe(true);
    expect(getDocsMock).toHaveBeenCalledTimes(1);
  });

  it("skips the own-documents read when there is no profile", async () => {
    singleContractors = null;
    const data = await loadPortalData(supabase);
    expect(data.profile).toBeNull();
    expect(data.docs).toBeNull();
    expect(getDocsMock).not.toHaveBeenCalled();
  });
});
