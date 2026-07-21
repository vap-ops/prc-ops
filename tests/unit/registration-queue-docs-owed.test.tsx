// Writing failing test first.
//
// Spec 333 U2 — the approval queue flags approved-with-deferred-docs rows whose
// documents are still incomplete, so HR can chase them from the existing list
// (the queue already renders approved rows — no new surface):
// (1) buildRegistrationQueueRow gains `documentsDeferredAt`; `docsOwed` is true
//     only for status=approved + stamp set + plain approval floor still unmet;
// (2) RegistrationQueueList renders an เอกสารค้าง chip on such a row.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildRegistrationQueueRow,
  type RegistrationQueueInput,
} from "@/lib/register/registration-queue-view";
import { RegistrationQueueList } from "@/components/features/registrations/registration-queue-list";

const OWED_CHIP = "เอกสารค้าง";

function input(overrides: Partial<RegistrationQueueInput>): RegistrationQueueInput {
  return {
    id: "reg-1",
    employeeId: "PRC-26-0004",
    fullName: "ณัฐวุฒิ ทดสอบ",
    status: "approved",
    createdAt: "2026-07-08T08:00:00Z",
    uploadedPurposes: [],
    hasBank: false,
    hasReviewerNote: false,
    invitedFirm: null,
    documentsDeferredAt: "2026-07-21T04:00:00Z",
    ...overrides,
  };
}

describe("buildRegistrationQueueRow — docsOwed (spec 333 U2)", () => {
  it("flags an approved deferred row whose documents are still missing", () => {
    expect(buildRegistrationQueueRow(input({})).docsOwed).toBe(true);
  });

  it("clears once the documents are complete", () => {
    const row = buildRegistrationQueueRow(
      input({ uploadedPurposes: ["id_card", "book_bank"], hasBank: true }),
    );
    expect(row.docsOwed).toBe(false);
  });

  it("never flags an approved row without the deferral stamp", () => {
    expect(buildRegistrationQueueRow(input({ documentsDeferredAt: null })).docsOwed).toBe(false);
  });

  it("never flags a pending row (the pending hint owns that state)", () => {
    expect(buildRegistrationQueueRow(input({ status: "pending" })).docsOwed).toBe(false);
  });

  it("ignores a stale invited firm — a deferred approval is never the contractor arm", () => {
    // Registered via a firm QR (advisory invited_contractor_id) but approved as
    // an office role with defer: meetsApprovalFloor's bank-exempt short-circuit
    // must NOT hide the owed book_bank/bank (fresh-eyes finding 1, 2026-07-21).
    const row = buildRegistrationQueueRow(
      input({
        invitedFirm: { id: "c1", name: "ช่างอวย" },
        uploadedPurposes: ["id_card"],
        hasBank: false,
      }),
    );
    expect(row.docsOwed).toBe(true);
  });
});

describe("RegistrationQueueList — เอกสารค้าง chip (spec 333 U2)", () => {
  it("renders the chip on a docs-owed row and not on a complete one", () => {
    const owed = buildRegistrationQueueRow(input({}));
    const complete = buildRegistrationQueueRow(
      input({
        id: "reg-2",
        employeeId: "PRC-26-0003",
        uploadedPurposes: ["id_card", "book_bank"],
        hasBank: true,
      }),
    );
    render(
      <RegistrationQueueList
        rows={[owed, complete]}
        detailHrefFor={(id) => `/registrations/${id}`}
        emptyMessage="ไม่มีคำขอสมัคร"
      />,
    );
    expect(screen.getAllByText(OWED_CHIP)).toHaveLength(1);
  });
});
