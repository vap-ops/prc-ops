// Writing failing test first.
//
// Spec 266 U7 (option C) — the ช่าง gets their OWN portal at /technician (not the
// subcontractor /portal). WorkerPortalSections is the worker-portal content
// (receipts, profile, tax id, consents, bank, wage history) extracted from
// /portal so /technician can host it and /portal reverts to subcontractor-only.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The client child components are tested on their own — mock them so this test
// isolates WorkerPortalSections' own logic (wage history, tax id, bank display).
vi.mock("@/components/features/portal/worker-profile-edit", () => ({
  WorkerProfileEdit: () => <div data-testid="worker-profile-edit" />,
}));
vi.mock("@/components/features/portal/worker-consents", () => ({
  WorkerConsents: () => <div data-testid="worker-consents" />,
}));
vi.mock("@/components/features/portal/worker-bank-change-form", () => ({
  WorkerBankChangeForm: ({ hasPending }: { hasPending: boolean }) => (
    <div data-testid="worker-bank-form" data-pending={String(hasPending)} />
  ),
}));
vi.mock("@/components/features/portal/portal-receipts", () => ({
  PortalReceipts: ({ receipts }: { receipts: unknown[] }) => (
    <div data-testid="portal-receipts" data-count={receipts.length} />
  ),
}));

import { WorkerPortalSections } from "@/components/features/portal/worker-portal-sections";

/* eslint-disable @typescript-eslint/no-explicit-any */
const WP = {
  name: "ช่างสมชาย",
  phone: "0810000000",
  email: "",
  emergency_contact_name: "",
  emergency_contact_relation: "",
  emergency_contact_phone: "",
  date_of_birth: "",
  tax_id: "1234567890123",
  bank_name: "กสิกรไทย",
  bank_account_number: "1112223334",
  bank_account_name: "สมชาย ใจดี",
} as any;

const PAYMENTS = [
  {
    id: "p1",
    period_from: "2026-06-01",
    period_to: "2026-06-30",
    paid_amount: 12000,
    paid_at: "2026-07-01",
    method: "bank_transfer",
  },
] as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("WorkerPortalSections", () => {
  it("renders the ช่าง's wage history, tax id, bank, and wires the child sections", () => {
    render(
      <WorkerPortalSections
        uid="11111111-1111-1111-1111-111111111111"
        wp={WP}
        payments={PAYMENTS}
        consents={[]}
        receipts={[]}
        hasPendingBank={false}
      />,
    );
    expect(screen.getByText("ประวัติการจ่ายเงิน")).toBeInTheDocument();
    expect(screen.getByText(/12,000/)).toBeInTheDocument();
    // tax id shows when present
    expect(screen.getByText("1234567890123")).toBeInTheDocument();
    // bank display
    expect(screen.getByText("กสิกรไทย")).toBeInTheDocument();
    // children wired
    expect(screen.getByTestId("worker-profile-edit")).toBeInTheDocument();
    expect(screen.getByTestId("worker-consents")).toBeInTheDocument();
    expect(screen.getByTestId("worker-bank-form")).toHaveAttribute("data-pending", "false");
  });

  it("shows the empty wage-history notice when there are no payments", () => {
    render(
      <WorkerPortalSections
        uid="11111111-1111-1111-1111-111111111111"
        wp={WP}
        payments={[]}
        consents={[]}
        receipts={[]}
        hasPendingBank
      />,
    );
    expect(screen.getByText("ยังไม่มีประวัติการจ่ายเงิน")).toBeInTheDocument();
    expect(screen.getByTestId("worker-bank-form")).toHaveAttribute("data-pending", "true");
  });
});
