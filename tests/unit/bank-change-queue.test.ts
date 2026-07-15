// Spec 186 U1 / spec 170 U4c-2 — the pure builders behind the bank-change
// approval queue page. Each pending request joins to its party name (fallback
// "—") for display, tagged with a `kind` so the page routes the decision to the
// right decide RPC (contractor vs worker). The page concatenates + sorts the two.

import { describe, it, expect } from "vitest";
import {
  buildBankChangeQueue,
  buildIdentityChangeQueue,
  buildWorkerBankChangeQueue,
  type BankChangeRequestRow,
  type IdentityChangeRequestRow,
  type WorkerBankChangeRequestRow,
} from "@/lib/approvals/bank-change-queue";

const NAMES = new Map([
  ["c-1", "ห้างหุ้นส่วน ก่อสร้างดี"],
  ["c-2", "ช่างรับเหมา สมชาย"],
]);

function row(
  p: Partial<BankChangeRequestRow> & Pick<BankChangeRequestRow, "id" | "contractor_id">,
): BankChangeRequestRow {
  return {
    bank_name: "กสิกรไทย",
    bank_account_no: "123-4-56789-0",
    bank_account_name: "สมชาย ใจดี",
    // Spec 317 U5 — the contractor request now carries the passbook path too.
    bank_book_path: "contractor/c-2/req.jpg",
    created_at: "2026-06-20T08:00:00Z",
    ...p,
  };
}

describe("buildBankChangeQueue (contractor)", () => {
  it("returns an empty list for no requests", () => {
    expect(buildBankChangeQueue([], NAMES)).toEqual([]);
  });

  it("joins each request to its contractor name, maps the bank fields, tags kind", () => {
    const result = buildBankChangeQueue([row({ id: "r1", contractor_id: "c-2" })], NAMES);
    expect(result).toEqual([
      {
        id: "r1",
        kind: "contractor",
        name: "ช่างรับเหมา สมชาย",
        bankName: "กสิกรไทย",
        accountNo: "123-4-56789-0",
        accountName: "สมชาย ใจดี",
        bookBankPath: "contractor/c-2/req.jpg",
        createdAt: "2026-06-20T08:00:00Z",
      },
    ]);
  });

  it("falls back to — when the contractor name is missing", () => {
    const result = buildBankChangeQueue([row({ id: "r2", contractor_id: "ghost" })], NAMES);
    expect(result[0]?.name).toBe("—");
  });

  it("preserves input order (the page pre-sorts oldest-first)", () => {
    const result = buildBankChangeQueue(
      [row({ id: "a", contractor_id: "c-1" }), row({ id: "b", contractor_id: "c-2" })],
      NAMES,
    );
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

const WORKER_NAMES = new Map([["w-1", "สมหญิง (ช่าง)"]]);

function workerRow(
  p: Partial<WorkerBankChangeRequestRow> & Pick<WorkerBankChangeRequestRow, "id" | "worker_id">,
): WorkerBankChangeRequestRow {
  return {
    bank_name: "ไทยพาณิชย์",
    bank_account_number: "987-6-54321-0",
    bank_account_name: "สมหญิง ขยัน",
    book_bank_path: "technician/u-1/book_bank/req.jpg",
    created_at: "2026-06-21T08:00:00Z",
    ...p,
  };
}

describe("buildWorkerBankChangeQueue", () => {
  it("joins each request to its worker name, maps bank_account_number→accountNo, tags kind", () => {
    const result = buildWorkerBankChangeQueue(
      [workerRow({ id: "wr1", worker_id: "w-1" })],
      WORKER_NAMES,
    );
    expect(result).toEqual([
      {
        id: "wr1",
        kind: "worker",
        name: "สมหญิง (ช่าง)",
        bankName: "ไทยพาณิชย์",
        accountNo: "987-6-54321-0",
        accountName: "สมหญิง ขยัน",
        // Spec 315 U2 — the passbook path rides along for the queue's photo render.
        bookBankPath: "technician/u-1/book_bank/req.jpg",
        createdAt: "2026-06-21T08:00:00Z",
      },
    ]);
  });

  it("falls back to — when the worker name is missing", () => {
    const result = buildWorkerBankChangeQueue(
      [workerRow({ id: "wr2", worker_id: "ghost" })],
      WORKER_NAMES,
    );
    expect(result[0]?.name).toBe("—");
  });
});

// Spec 317 U3 — identity change requests join the same queue page.
const USER_NAMES = new Map([["u-1", "ชื่อเก่า ทดสอบ"]]);

function identityRow(
  p: Partial<IdentityChangeRequestRow> & Pick<IdentityChangeRequestRow, "id" | "user_id">,
): IdentityChangeRequestRow {
  return {
    proposed_full_name: "ชื่อใหม่ ทดสอบ",
    proposed_national_id: "3101200000670",
    proposed_dob: "1990-02-20",
    created_at: "2026-07-14T08:00:00Z",
    ...p,
  };
}

describe("buildIdentityChangeQueue", () => {
  it("joins the requester's current name and carries the proposed fields", () => {
    const result = buildIdentityChangeQueue(
      [identityRow({ id: "ir1", user_id: "u-1" })],
      USER_NAMES,
    );
    expect(result).toEqual([
      {
        id: "ir1",
        kind: "identity",
        name: "ชื่อเก่า ทดสอบ",
        proposedFullName: "ชื่อใหม่ ทดสอบ",
        proposedNationalId: "3101200000670",
        proposedDob: "1990-02-20",
        createdAt: "2026-07-14T08:00:00Z",
      },
    ]);
  });

  it("falls back to — for an unknown requester and nulls stay null", () => {
    const result = buildIdentityChangeQueue(
      [
        identityRow({
          id: "ir2",
          user_id: "ghost",
          proposed_national_id: null,
          proposed_dob: null,
        }),
      ],
      USER_NAMES,
    );
    expect(result[0]?.name).toBe("—");
    expect(result[0]?.proposedNationalId).toBeNull();
    expect(result[0]?.proposedDob).toBeNull();
  });
});

// Spec 317 U4 — staff bank changes join the queue with the worker-card shape.
import {
  buildStaffBankChangeQueue,
  type StaffBankChangeRequestRow,
} from "@/lib/approvals/bank-change-queue";

const REG_NAMES = new Map([["r-1", "บัญชี หนึ่ง"]]);

function staffRow(
  p: Partial<StaffBankChangeRequestRow> & Pick<StaffBankChangeRequestRow, "id" | "registration_id">,
): StaffBankChangeRequestRow {
  return {
    bank_name: "กสิกรไทย",
    bank_account_number: "9998887776",
    bank_account_name: "บัญชี หนึ่ง",
    book_bank_path: "technician/u-1/book_bank/req.jpg",
    created_at: "2026-07-14T09:00:00Z",
    ...p,
  };
}

describe("buildStaffBankChangeQueue", () => {
  it("joins the staffer's name and tags kind staff-bank with the passbook path", () => {
    const result = buildStaffBankChangeQueue(
      [staffRow({ id: "sr1", registration_id: "r-1" })],
      REG_NAMES,
    );
    expect(result).toEqual([
      {
        id: "sr1",
        kind: "staff-bank",
        name: "บัญชี หนึ่ง",
        bankName: "กสิกรไทย",
        accountNo: "9998887776",
        accountName: "บัญชี หนึ่ง",
        bookBankPath: "technician/u-1/book_bank/req.jpg",
        createdAt: "2026-07-14T09:00:00Z",
      },
    ]);
  });

  it("falls back to — for an unknown registration", () => {
    const result = buildStaffBankChangeQueue(
      [staffRow({ id: "sr2", registration_id: "ghost" })],
      REG_NAMES,
    );
    expect(result[0]?.name).toBe("—");
  });
});

// Spec 319 — login-keyed (admin/office) bank changes join the queue with the
// worker-card shape, keyed on the requester's user_id.
import {
  buildUserBankChangeQueue,
  type UserBankChangeRequestRow,
} from "@/lib/approvals/bank-change-queue";

const OFFICER_NAMES = new Map([["ou-1", "เจ้าหน้าที่ หนึ่ง"]]);

function officerRow(
  p: Partial<UserBankChangeRequestRow> & Pick<UserBankChangeRequestRow, "id" | "user_id">,
): UserBankChangeRequestRow {
  return {
    bank_name: "ไทยพาณิชย์",
    bank_account_number: "1231231231",
    bank_account_name: "เจ้าหน้าที่ หนึ่ง",
    book_bank_path: "technician/ou-1/book_bank/req.jpg",
    created_at: "2026-07-15T09:00:00Z",
    ...p,
  };
}

describe("buildUserBankChangeQueue", () => {
  it("joins the requester's name and tags kind user-bank with the passbook path", () => {
    const result = buildUserBankChangeQueue(
      [officerRow({ id: "ub1", user_id: "ou-1" })],
      OFFICER_NAMES,
    );
    expect(result).toEqual([
      {
        id: "ub1",
        kind: "user-bank",
        name: "เจ้าหน้าที่ หนึ่ง",
        bankName: "ไทยพาณิชย์",
        accountNo: "1231231231",
        accountName: "เจ้าหน้าที่ หนึ่ง",
        bookBankPath: "technician/ou-1/book_bank/req.jpg",
        createdAt: "2026-07-15T09:00:00Z",
      },
    ]);
  });

  it("falls back to — for an unknown requester", () => {
    const result = buildUserBankChangeQueue(
      [officerRow({ id: "ub2", user_id: "ghost" })],
      OFFICER_NAMES,
    );
    expect(result[0]?.name).toBe("—");
  });
});
