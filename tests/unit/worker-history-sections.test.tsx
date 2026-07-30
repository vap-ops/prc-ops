// Writing failing test first.
//
// Spec 376 U3 (D3) — the /technician split. WorkerPortalSections was one stack of
// six sections on a single scroll page; the MONEY half (รายการรอรับ → wage history
// → bank) moves to WorkerHistorySections, rendered on the new ประวัติ route, and
// the identity half (contact + tax id + consents) stays behind on หน้าหลัก.
//
// Every assertion that left worker-portal-sections.test.tsx reappears here, so the
// split moves coverage rather than deleting it: the ประวัติการจ่ายเงิน heading, the
// 12,000 amount, the empty-history notice, the hasPendingBank wiring, and both
// bankExempt cases (hidden / kept). New here: the receipts count and the
// descending period sort (the old file asserted neither).

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The client children are tested on their own — mock them so this test isolates
// WorkerHistorySections' own logic (sort order, empty state, bank visibility).
vi.mock("@/components/features/profile/profile-bank-section", () => ({
  ProfileBankSection: ({ hasPending }: { hasPending: boolean }) => (
    <div data-testid="worker-bank-form" data-pending={String(hasPending)} />
  ),
}));
vi.mock("@/components/features/portal/portal-receipts", () => ({
  PortalReceipts: ({ receipts }: { receipts: unknown[] }) => (
    <div data-testid="portal-receipts" data-count={receipts.length} />
  ),
}));

import { WorkerHistorySections } from "@/components/features/portal/worker-history-sections";

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

// Deliberately oldest-first in the fixture: the component sorts by period_to
// descending, so a component that renders the array as given fails this.
const PAYMENTS = [
  {
    id: "p-may",
    period_from: "2026-05-01",
    period_to: "2026-05-31",
    paid_amount: 9000,
    paid_at: "2026-06-01",
    method: "bank_transfer",
  },
  {
    id: "p-jun",
    period_from: "2026-06-01",
    period_to: "2026-06-30",
    paid_amount: 12000,
    paid_at: "2026-07-01",
    method: "bank_transfer",
  },
] as any;

const RECEIPTS = [
  { id: "r1", baseItem: "ปูน", specAttrs: null, unit: "ถุง", qty: 2, wpLabel: "A1 งานพื้น" },
] as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const UID = "11111111-1111-1111-1111-111111111111";

describe("WorkerHistorySections (spec 376 U3)", () => {
  it("renders the wage history newest-first and wires the receipts + bank children", () => {
    const { container } = render(
      <WorkerHistorySections
        uid={UID}
        wp={WP}
        payments={PAYMENTS}
        receipts={RECEIPTS}
        hasPendingBank={false}
      />,
    );
    expect(screen.getByText("ประวัติการจ่ายเงิน")).toBeInTheDocument();
    expect(screen.getByText(/12,000/)).toBeInTheDocument();
    // Newest period first, regardless of the order the RPC returned.
    const rows = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/12,000/);
    expect(rows[1]).toMatch(/9,000/);
    // The actionable รายการรอรับ surface leads the page (spec 177 U8).
    expect(screen.getByText("รายการรอรับ")).toBeInTheDocument();
    expect(screen.getByTestId("portal-receipts")).toHaveAttribute("data-count", "1");
    expect(screen.getByTestId("worker-bank-form")).toHaveAttribute("data-pending", "false");
  });

  it("shows the empty wage-history notice when there are no payments", () => {
    render(<WorkerHistorySections uid={UID} wp={WP} payments={[]} receipts={[]} hasPendingBank />);
    expect(screen.getByText("ยังไม่มีประวัติการจ่ายเงิน")).toBeInTheDocument();
    expect(screen.getByTestId("worker-bank-form")).toHaveAttribute("data-pending", "true");
  });

  // Spec 328 U3 — a contractor-tied (pay-exempt) member never sees the bank
  // section: PRC never pays them (the firm does), so there is no bank to keep.
  // The rule rides along with the section it governs — it was asserted on
  // WorkerPortalSections before the split.
  it("hides the bank section entirely for a contractor-tied member (bankExempt)", () => {
    render(
      <WorkerHistorySections
        uid={UID}
        wp={WP}
        payments={[]}
        receipts={[]}
        hasPendingBank={false}
        bankExempt
      />,
    );
    expect(screen.queryByText("บัญชีธนาคาร")).not.toBeInTheDocument();
    expect(screen.queryByTestId("worker-bank-form")).not.toBeInTheDocument();
  });

  it("keeps the bank section for a regular (non-exempt) worker", () => {
    render(
      <WorkerHistorySections
        uid={UID}
        wp={WP}
        payments={[]}
        receipts={[]}
        hasPendingBank={false}
      />,
    );
    expect(screen.getByText("บัญชีธนาคาร")).toBeInTheDocument();
    expect(screen.getByTestId("worker-bank-form")).toBeInTheDocument();
  });

  // The split's whole point: the identity half is NOT on this route.
  it("carries none of the identity half (contact + consents live on หน้าหลัก)", () => {
    render(
      <WorkerHistorySections
        uid={UID}
        wp={WP}
        payments={PAYMENTS}
        receipts={RECEIPTS}
        hasPendingBank={false}
      />,
    );
    expect(screen.queryByText("ข้อมูลของฉัน")).not.toBeInTheDocument();
    expect(screen.queryByText("ความยินยอม")).not.toBeInTheDocument();
  });
});
