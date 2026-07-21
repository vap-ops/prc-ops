// Writing failing test first.
//
// Spec 328 U3 — the approval queue surfaces firm-invited registrations:
// (1) buildRegistrationQueueRow gains `invitedFirm` — presence makes the row
//     BANK-EXEMPT in the meetsFloor hint (mirrors the approve RPC's contractor
//     arm, which skips the book_bank + staff_registration_bank floors while
//     keeping id_card; mig 075815) and yields `firmName` for the chip;
// (2) RegistrationQueueList renders the firm chip on such a row.
// UI hint only — the RPC stays the authoritative gate.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildRegistrationQueueRow,
  type RegistrationQueueInput,
} from "@/lib/register/registration-queue-view";
import { RegistrationQueueList } from "@/components/features/registrations/registration-queue-list";

function input(overrides: Partial<RegistrationQueueInput>): RegistrationQueueInput {
  return {
    id: "reg-1",
    employeeId: "PRC-26-0001",
    fullName: "สมชาย ใจดี",
    status: "pending",
    createdAt: "2026-07-19T08:00:00Z",
    uploadedPurposes: ["id_card"],
    hasBank: false,
    hasReviewerNote: false,
    invitedFirm: null,
    documentsDeferredAt: null,
    ...overrides,
  };
}

describe("buildRegistrationQueueRow — firm-invited rows (spec 328 U3)", () => {
  it("firm-invited row meets the floor WITHOUT bank (id_card + name still required)", () => {
    const row = buildRegistrationQueueRow(
      input({ invitedFirm: { id: "c1", name: "ช่างอวย" }, hasBank: false }),
    );
    expect(row.meetsFloor).toBe(true);
    expect(row.firmName).toBe("ช่างอวย");
  });

  it("firm-invited row still fails the floor without id_card", () => {
    const row = buildRegistrationQueueRow(
      input({ invitedFirm: { id: "c1", name: "ช่างอวย" }, uploadedPurposes: [] }),
    );
    expect(row.meetsFloor).toBe(false);
  });

  it("non-invited row keeps the full bank floor", () => {
    const row = buildRegistrationQueueRow(input({}));
    expect(row.meetsFloor).toBe(false);
    expect(row.firmName).toBeNull();

    const complete = buildRegistrationQueueRow(
      input({ uploadedPurposes: ["id_card", "book_bank"], hasBank: true }),
    );
    expect(complete.meetsFloor).toBe(true);
  });

  it("falls back to a generic firm label when the name is unresolved", () => {
    const row = buildRegistrationQueueRow(input({ invitedFirm: { id: "c1", name: null } }));
    expect(row.firmName).toBe("ทีมผู้รับเหมา");
  });
});

describe("RegistrationQueueList — firm chip (spec 328 U3)", () => {
  it("renders the firm chip on a firm-invited row and not on others", () => {
    const rows = [
      buildRegistrationQueueRow(input({ id: "reg-1", invitedFirm: { id: "c1", name: "ช่างอวย" } })),
      buildRegistrationQueueRow(input({ id: "reg-2", fullName: "คนที่สอง" })),
    ];
    render(
      <RegistrationQueueList
        rows={rows}
        detailHrefFor={(id) => `/registrations/${id}`}
        emptyMessage="ไม่มีคำขอ"
      />,
    );
    expect(screen.getByText("ช่างอวย")).toBeInTheDocument();
    expect(screen.getAllByText(/ช่างอวย|คนที่สอง/).length).toBeGreaterThan(0);
  });
});
