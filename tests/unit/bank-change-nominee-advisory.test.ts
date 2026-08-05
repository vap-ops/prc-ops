// Writing failing test first.
//
// Spec 395 U3, the SECOND door. §2: "`/workers` is NOT the only path into
// `workers.bank_*`. `worker_bank_change_requests` … also writes all three bank columns
// — the ช่าง's own self-service request, approved by back-office — and that path equally
// bypasses the nominee. Any unit that claims to route third-party accounts to the right
// place must cover both doors or it is incomplete."
//
// ⓘ MEASURED BEFORE BUILDING (2026-08-05): that table holds **one row all-time**
// (approved, 2026-07-14) and **zero pending**. So this is a thin guard on a near-dormant
// path, and it cannot be verified against live pending data because there is none. It is
// built because the door is real, not because it is busy — and U1's detector badges
// whatever arrives through it on the next `/workers` view regardless.
//
// ⚠️ ADVISORY ONLY. It never blocks an approval: a family member's account is normal
// here, and the approver — not this code — knows whose account it is.
//
// ⚠️ Scoped to the WORKER kind. A contractor's account holder is a FIRM, so comparing it
// to a person's name is meaningless; staff-bank belongs to spec 317 and its `name`
// semantics are not verified here.

import { describe, expect, it } from "vitest";
import {
  requestedAccountNameDiffers,
  type BankChangeQueueItem,
} from "@/lib/approvals/bank-change-queue";

const item = (over: Partial<BankChangeQueueItem>): BankChangeQueueItem => ({
  id: "r1",
  kind: "worker",
  name: "นายสายฟ้า บุญเกิด",
  bankName: "กสิกรไทย",
  accountNo: "1234567890",
  accountName: "นายสายฟ้า บุญเกิด",
  createdAt: "2026-08-05T00:00:00Z",
  ...over,
});

describe("requestedAccountNameDiffers", () => {
  it("is quiet when the requested holder is the worker", () => {
    expect(requestedAccountNameDiffers(item({}))).toBe(false);
  });

  // The same normalisation the detector uses — honorific stripped, whitespace collapsed.
  // Without it this would fire on every ordinary request and be ignored within a week.
  it("is quiet across honorific and whitespace variance", () => {
    expect(
      requestedAccountNameDiffers(
        item({ name: "นายสายฟ้า บุญเกิด", accountName: "สายฟ้า  บุญเกิด" }),
      ),
    ).toBe(false);
  });

  it("flags a genuinely different holder", () => {
    expect(requestedAccountNameDiffers(item({ accountName: "ด.ช.อนันตชัย ทีฆายุทธสกุล" }))).toBe(
      true,
    );
  });

  // ⚠️ Absence of evidence is not a match — the same rule isNormalisingRename enforces.
  // A blank holder must not read as "it is theirs".
  it("flags a blank or honorific-only holder rather than assuming it is theirs", () => {
    expect(requestedAccountNameDiffers(item({ accountName: "" }))).toBe(true);
    expect(requestedAccountNameDiffers(item({ accountName: null }))).toBe(true);
    expect(requestedAccountNameDiffers(item({ accountName: "นาย" }))).toBe(true);
  });

  // A contractor's holder is the FIRM. Comparing it to a person's name would fire on
  // essentially every contractor request and teach the approver to ignore the notice.
  it("never fires on a contractor request, whose holder is a company", () => {
    expect(
      requestedAccountNameDiffers(
        item({ kind: "contractor", name: "ห้างหุ้นส่วน ก่อสร้างดี", accountName: "บจก. อื่น" }),
      ),
    ).toBe(false);
  });

  it("never fires on a staff-bank request — spec 317 owns that kind", () => {
    expect(
      requestedAccountNameDiffers(item({ kind: "staff-bank", accountName: "คนอื่น เลย" })),
    ).toBe(false);
  });
});
