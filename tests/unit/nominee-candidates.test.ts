// Writing failing test first.
//
// Spec 395 U3 — who the nominee picker may offer.
//
// ⚠️ THE BUG THIS CLOSES, found while building U2: the picker listed ONLY workers with
// no bank account of their own ("เลือกช่างที่ยังไม่มีบัญชีธนาคารของตัวเอง"). Every worker
// spec 395 is about HAS an account — it just is not theirs — so **none of the 8 live
// cases was selectable through the normal flow at all**. U2 could only reach them by
// deep-linking `?worker=<uuid>`, which works but is not a route a human finds.
//
// The population is therefore a UNION of two reasons a nominee makes sense:
//   no-account       — the original spec 320 case: nothing of their own to pay into
//   not-own-account  — spec 395's case: an account that belongs to someone else
//
// ⚠️ Contractor-tied workers stay excluded from BOTH arms (spec 328 U3): a pay-exempt
// subcon member is permanently bankless BY DESIGN — the firm pays the subcontractor,
// so routing a nominee payout for one would move money PRC never owes. Measured
// 2026-08-05: all 8 live `unrecorded` workers are firm-paid, so this excludes none of
// them today; it is the rule that matters, not the current count.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockAudit, mockBankless } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockAudit: vi.fn(),
  mockBankless: vi.fn(),
}));

vi.mock("@/lib/db/admin", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/payroll/payout-nominee", () => ({
  listActivePayoutNominees: vi.fn().mockResolvedValue([]),
  listBanklessWorkers: mockBankless,
}));

import { listNomineeCandidates } from "@/lib/workers/payout-account-audit";

const SERVER = {} as never;

// admin.from("workers").select(...).in("id", ids) → rows
function adminReturning(rows: unknown) {
  const inFn = vi.fn().mockResolvedValue({ data: rows, error: null });
  const selectFn = vi.fn().mockReturnValue({ in: inFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });
  return { client: { from: fromFn }, inFn, selectFn };
}

describe("listNomineeCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBankless.mockResolvedValue([]);
    mockAudit.mockResolvedValue([]);
  });

  it("offers a worker whose account is not their own — the case the picker used to hide", async () => {
    const { client } = adminReturning([
      { id: "w1", name: "นายสายฟ้า บุญเกิด", employee_id: "PRC-26-0007", contractor_id: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const out = await listNomineeCandidates(SERVER, [
      {
        workerId: "w1",
        state: "unrecorded",
        accountWorkerCount: 2,
        isShared: true,
        nameMatches: false,
      },
    ]);
    expect(out).toEqual([
      { id: "w1", name: "นายสายฟ้า บุญเกิด", code: "PRC-26-0007", reason: "not-own-account" },
    ]);
  });

  it("keeps the original bankless population, tagged with its own reason", async () => {
    mockBankless.mockResolvedValue([{ id: "b1", name: "นายไม่มี บัญชี", code: "PRC-26-0009" }]);
    const { client } = adminReturning([]);
    mockCreateClient.mockReturnValue(client);

    const out = await listNomineeCandidates(SERVER, []);
    expect(out).toEqual([
      { id: "b1", name: "นายไม่มี บัญชี", code: "PRC-26-0009", reason: "no-account" },
    ]);
  });

  // ⚠️ The firm pays the subcontractor, not the worker — a nominee payout for one would
  // move money PRC never owes. spec 328 U3's rule, applied to the new arm too.
  it("excludes a contractor-tied worker even when the account is not their own", async () => {
    const { client } = adminReturning([
      { id: "w2", name: "นายซับ คอน", employee_id: null, contractor_id: "c1" },
    ]);
    mockCreateClient.mockReturnValue(client);

    const out = await listNomineeCandidates(SERVER, [
      {
        workerId: "w2",
        state: "unrecorded",
        accountWorkerCount: 2,
        isShared: true,
        nameMatches: false,
      },
    ]);
    expect(out).toEqual([]);
  });

  it("offers nobody whose account is already own or already recorded", async () => {
    const { client, inFn } = adminReturning([]);
    mockCreateClient.mockReturnValue(client);

    const out = await listNomineeCandidates(SERVER, [
      { workerId: "a", state: "own", accountWorkerCount: 1, isShared: false, nameMatches: true },
      {
        workerId: "b",
        state: "nominee",
        accountWorkerCount: 2,
        isShared: true,
        nameMatches: false,
      },
    ]);
    expect(out).toEqual([]);
    // …and it does not go to the database for an empty id list.
    expect(inFn).not.toHaveBeenCalled();
  });

  it("sorts by name so the two reasons interleave rather than forming hidden blocks", async () => {
    mockBankless.mockResolvedValue([{ id: "b1", name: "ขไก่", code: null }]);
    const { client } = adminReturning([
      { id: "w1", name: "กไก่", employee_id: null, contractor_id: null },
      { id: "w2", name: "คควาย", employee_id: null, contractor_id: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const out = await listNomineeCandidates(SERVER, [
      {
        workerId: "w1",
        state: "unrecorded",
        accountWorkerCount: 1,
        isShared: false,
        nameMatches: false,
      },
      {
        workerId: "w2",
        state: "unrecorded",
        accountWorkerCount: 2,
        isShared: true,
        nameMatches: false,
      },
    ]);
    expect(out.map((c) => c.name)).toEqual(["กไก่", "ขไก่", "คควาย"]);
  });
});
