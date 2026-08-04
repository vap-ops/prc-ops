// Writing failing test first.
//
// Spec 395 U1 — the admin seam behind the payout-account detector.
//
// Why a seam at all, verified live 2026-08-04:
//   has_column_privilege('authenticated','public.workers','bank_account_number','SELECT') = FALSE
//   has_column_privilege('authenticated','public.workers','bank_account_name','SELECT')   = FALSE
// The bank columns are zero-grant PII, and the shared-account count is inherently
// cross-worker, so this is not expressible under row-level scoping at all — exactly
// as spec §4 states. It must go through the admin client, like payout-nominee.ts.
//
// These tests pin the SEAM (which columns, which filter, where the nominee ids come
// from). The classification rules themselves live in payout-account.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockListActiveNominees } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockListActiveNominees: vi.fn(),
}));

vi.mock("@/lib/db/admin", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/payroll/payout-nominee", () => ({
  listActivePayoutNominees: mockListActiveNominees,
}));

import { loadPayoutAccountAudit } from "@/lib/workers/payout-account-audit";

function adminReturning(result: { data: unknown; error: unknown }) {
  const eqFn = vi.fn().mockResolvedValue(result);
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });
  return { client: { from: fromFn }, fromFn, selectFn, eqFn };
}

const SERVER = {} as never;

const LIVE_ROWS = [
  // The concentration account — three workers, one minor's account.
  {
    id: "w1",
    name: "นางสาว โนรี ทิพย์โภชน์",
    bank_account_number: "014162319729",
    bank_account_name: "ด.ช.อนันตชัย  ฑีฆายุทธสกุล",
  },
  {
    id: "w2",
    name: "นาย พิเชษฐ์ พันธุพัฒน์",
    bank_account_number: "014162319729",
    bank_account_name: "ด.ช.อนันตชัย  ฑีฆายุทธสกุล",
  },
  {
    id: "w3",
    name: "นายสายฟ้า บุญเกิด",
    bank_account_number: "014162319729",
    bank_account_name: "ด.ช.อนันตชัย ทีฆายุทธสกุล",
  },
  // A clean own-account row. ⚠️ SYNTHETIC account number: the live 1130967980 carries
  // TWO workers, so reusing it here would assert `own` for someone the live detector
  // calls `unrecorded`.
  {
    id: "w4",
    name: "นางสาวปาณิศา บุญเรือง",
    bank_account_number: "9000000001",
    bank_account_name: "ปาณิศา บุญเรือง",
  },
];

describe("loadPayoutAccountAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListActiveNominees.mockResolvedValue([]);
  });

  it("reads the bank columns through the ADMIN client, active workers only", async () => {
    const { client, fromFn, selectFn, eqFn } = adminReturning({ data: LIVE_ROWS, error: null });
    mockCreateClient.mockReturnValue(client);

    await loadPayoutAccountAudit(SERVER);

    expect(mockCreateClient).toHaveBeenCalled();
    expect(fromFn).toHaveBeenCalledWith("workers");
    expect(selectFn).toHaveBeenCalledWith("id, name, bank_account_number, bank_account_name");
    // ⚠️ The active filter is the one that keeps spec 396's deactivated mis-edit row
    // out of the shared-account count. Without it, account 020203221364 reads as
    // shared forever off the back of an UNREPAIRED artefact — that row still carries
    // the original employee's phone and employee id, and restoring it needs her own
    // answers, so spec 396 owns the repair and U1 simply scopes past it.
    expect(eqFn).toHaveBeenCalledWith("active", true);
  });

  it("classifies the live shapes end to end", async () => {
    const { client } = adminReturning({ data: LIVE_ROWS, error: null });
    mockCreateClient.mockReturnValue(client);

    const out = await loadPayoutAccountAudit(SERVER);
    const byId = new Map(out.map((a) => [a.workerId, a]));

    expect(byId.get("w1")?.accountWorkerCount).toBe(3);
    expect(byId.get("w1")?.state).toBe("unrecorded");
    expect(byId.get("w4")?.state).toBe("own");
    expect(byId.get("w4")?.accountWorkerCount).toBe(1);
  });

  it("takes the nominee ids from the DEFINER RPC, not from the admin read", async () => {
    const { client } = adminReturning({ data: LIVE_ROWS, error: null });
    mockCreateClient.mockReturnValue(client);
    mockListActiveNominees.mockResolvedValue([{ workerId: "w1", accountNumber: "014162319729" }]);

    const out = await loadPayoutAccountAudit(SERVER);
    const byId = new Map(out.map((a) => [a.workerId, a]));

    expect(mockListActiveNominees).toHaveBeenCalledWith(SERVER);
    expect(byId.get("w1")?.state).toBe("nominee");
    // its neighbours on the same account are untouched
    expect(byId.get("w2")?.state).toBe("unrecorded");
  });

  // ⚠️ A nominee record consents to ONE account. Payroll pays whatever sits in
  // `workers.bank_account_number` — so a nominee recorded for account X while the
  // worker row has since moved to a different third-party account Y describes an
  // arrangement that is no longer the one being paid. Treating mere EXISTENCE as
  // consent would silence the flag permanently, which is the failure this whole
  // detector exists to prevent.
  it("does not count a nominee recorded for a DIFFERENT account than the one on file", async () => {
    const { client } = adminReturning({ data: LIVE_ROWS, error: null });
    mockCreateClient.mockReturnValue(client);
    mockListActiveNominees.mockResolvedValue([{ workerId: "w1", accountNumber: "999999999999" }]);

    const out = await loadPayoutAccountAudit(SERVER);
    expect(new Map(out.map((a) => [a.workerId, a])).get("w1")?.state).toBe("unrecorded");
  });

  // ⚠️ The nominee number is stored separator-stripped by the RPC; the worker's is stored
  // as typed. Without normalising both sides a recorded nominee would never clear the
  // badge, and nothing on screen would explain why.
  it("matches coverage across separator formatting on either side", async () => {
    const { client } = adminReturning({
      data: [
        {
          id: "w9",
          name: "นายสายฟ้า บุญเกิด",
          bank_account_number: "014-1623197-29",
          bank_account_name: "ด.ช.อนันตชัย ทีฆายุทธสกุล",
        },
      ],
      error: null,
    });
    mockCreateClient.mockReturnValue(client);
    mockListActiveNominees.mockResolvedValue([{ workerId: "w9", accountNumber: "014162319729" }]);

    const out = await loadPayoutAccountAudit(SERVER);
    expect(out[0]?.state).toBe("nominee");
  });

  // Same failure class as the admin read: a silent [] would report every consented
  // worker as unrecorded, and nothing would say why.
  it("throws when the nominee RPC fails rather than treating it as 'no nominees'", async () => {
    const { client } = adminReturning({ data: LIVE_ROWS, error: null });
    mockCreateClient.mockReturnValue(client);
    mockListActiveNominees.mockRejectedValue(new Error("rpc denied"));

    await expect(loadPayoutAccountAudit(SERVER)).rejects.toThrow(/rpc denied/i);
  });

  // The detector's whole job is to make a gap countable. A read error that silently
  // returned [] would report "nothing to record" — the most dangerous possible lie
  // for this feature, and indistinguishable from success.
  it("throws on a read error rather than reporting an empty worklist", async () => {
    const { client } = adminReturning({ data: null, error: { message: "boom" } });
    mockCreateClient.mockReturnValue(client);

    await expect(loadPayoutAccountAudit(SERVER)).rejects.toThrow(/boom|payout account/i);
  });
});
