// Spec 296 U3 — the approver's read of an applicant's declared bank. The typed
// bank lives in the zero-grant staff_registration_bank table (unreadable by an
// authenticated RLS session, incl. an in-project site_admin), so — unlike the
// other approval-detail row reads — this ONE read uses the service-role admin
// client, scoped to the single registration the approver already passed
// requireRole + the RLS row read for (same exposure model as admin-line-identity).
// The admin client is mocked at the module boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));

vi.mock("@/lib/db/admin", () => ({
  createClient: mockCreateClient,
}));

import { getRegistrationBank } from "@/lib/register/admin-registration-bank";

function clientReturning(result: { data: unknown; error: unknown }) {
  const maybeSingleFn = vi.fn().mockResolvedValue(result);
  const eqFn = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });
  return { client: { from: fromFn }, fromFn, selectFn, eqFn, maybeSingleFn };
}

describe("getRegistrationBank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the declared bank fields (snake→camel) for a registration", async () => {
    const { client, fromFn, eqFn } = clientReturning({
      data: {
        bank_name: "ธ.กสิกรไทย",
        bank_account_number: "1234567890",
        bank_account_name: "สมชาย ใจดี",
      },
      error: null,
    });
    mockCreateClient.mockReturnValue(client);

    const result = await getRegistrationBank("reg-1");
    expect(fromFn).toHaveBeenCalledWith("staff_registration_bank");
    expect(eqFn).toHaveBeenCalledWith("registration_id", "reg-1");
    expect(result).toEqual({
      bankName: "ธ.กสิกรไทย",
      accountNumber: "1234567890",
      accountName: "สมชาย ใจดี",
    });
  });

  it("returns null when the applicant has not declared a bank yet", async () => {
    const { client } = clientReturning({ data: null, error: null });
    mockCreateClient.mockReturnValue(client);

    const result = await getRegistrationBank("reg-2");
    expect(result).toBeNull();
  });
});
