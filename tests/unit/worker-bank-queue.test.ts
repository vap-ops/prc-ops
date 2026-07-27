// Writing failing test first.
//
// Spec 298 U3 — the PM completion queue reader. worker_bank_capture is zero-grant
// (only service_role reads it), and the passbook lives in the walled sa-bank-capture/
// store (no authenticated SELECT). So this reader uses the service-role admin client,
// scoped to pending_pm captures the approver (requireRole(STAFF_APPROVAL_ROLES) on the
// page) is authorized to complete. It lists worker identity + a short-lived SIGNED
// passbook URL so the PM can transcribe the bank. Admin client mocked at the boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));

vi.mock("@/lib/db/admin", () => ({ createClient: mockCreateClient }));

import {
  countWorkersAwaitingBank,
  listWorkersAwaitingBank,
} from "@/lib/register/worker-bank-queue";

function adminReturning(rows: unknown[], signedUrl: string | null = "https://signed/x.jpg") {
  const orderFn = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eqFn = vi.fn().mockReturnValue({ order: orderFn });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });
  const createSignedUrlFn = vi
    .fn()
    .mockResolvedValue({ data: signedUrl ? { signedUrl } : null, error: null });
  const storageFromFn = vi.fn().mockReturnValue({ createSignedUrl: createSignedUrlFn });
  return {
    client: { from: fromFn, storage: { from: storageFromFn } },
    fromFn,
    selectFn,
    eqFn,
    createSignedUrlFn,
  };
}

describe("listWorkersAwaitingBank — spec 298 U3", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists pending_pm captures with worker identity + a signed passbook URL", async () => {
    const { client, fromFn, eqFn, createSignedUrlFn } = adminReturning([
      {
        worker_id: "w1",
        photo_path: "sa-bank-capture/2026/a.jpg",
        workers: { name: "สมชาย ช่างดี", employee_id: "PRC-26-0001" },
      },
    ]);
    mockCreateClient.mockReturnValue(client);

    const rows = await listWorkersAwaitingBank();
    expect(fromFn).toHaveBeenCalledWith("worker_bank_capture");
    expect(eqFn).toHaveBeenCalledWith("status", "pending_pm");
    expect(createSignedUrlFn).toHaveBeenCalledWith(
      "sa-bank-capture/2026/a.jpg",
      expect.any(Number),
    );
    expect(rows).toEqual([
      {
        workerId: "w1",
        name: "สมชาย ช่างดี",
        employeeId: "PRC-26-0001",
        photoUrl: "https://signed/x.jpg",
      },
    ]);
  });

  it("returns an empty list when nothing is pending", async () => {
    const { client } = adminReturning([]);
    mockCreateClient.mockReturnValue(client);
    expect(await listWorkersAwaitingBank()).toEqual([]);
  });
});

// 2026-07-27 — the /team + /registrations badge reader. Fresh-eyes found this
// function had ZERO behavioural coverage: deleting its `.eq("status","pending_pm")`
// left the whole suite green, because the only assertions on it were source scans.
// That mutant is the worst one available here — the badge would count EVERY capture
// row ever created, so the danger bubble could never fall back to zero however many
// passbooks were transcribed. A permanent red "14" nobody can clear inverts the
// entire premise of the unit it was built for ("a signal that does not signal").
function adminCounting(count: number | null) {
  const eqFn = vi.fn().mockResolvedValue({ count, error: null });
  const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });
  return { client: { from: fromFn }, fromFn, selectFn, eqFn };
}

describe("countWorkersAwaitingBank — the hub badge reader", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts ONLY pending_pm captures, as a head-count with no rows", async () => {
    const { client, fromFn, selectFn, eqFn } = adminCounting(14);
    mockCreateClient.mockReturnValue(client);

    await expect(countWorkersAwaitingBank()).resolves.toBe(14);
    expect(fromFn).toHaveBeenCalledWith("worker_bank_capture");
    // head:true is what keeps this cheap — the sibling list reader signs a Storage
    // URL per row, so counting through it would sign once per waiting worker.
    expect(selectFn).toHaveBeenCalledWith("worker_id", { count: "exact", head: true });
    // …and this is the assertion whose absence let the killer mutant survive.
    expect(eqFn).toHaveBeenCalledWith("status", "pending_pm");
  });

  it("treats a null count as zero rather than rendering a bubble of NaN", async () => {
    const { client } = adminCounting(null);
    mockCreateClient.mockReturnValue(client);
    await expect(countWorkersAwaitingBank()).resolves.toBe(0);
  });
});
