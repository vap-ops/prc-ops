// Spec 376 U3 (D3) split the ช่าง's MONEY half (รายการรอรับ → wage history →
// bank) out of WorkerPortalSections onto the ประวัติ route.
//
// Spec 388 U2 rewrote what this component is. ประวัติ became ATTENDANCE (that tab
// had 0 route views all-time), so this block moved BACK to หน้าหลัก, and two of
// its three parts changed with the move:
//   * รายการรอรับ left it entirely — it is the only write a ช่าง owns, so it
//     mounts high on หน้าหลัก under the QR, not inside a money block (D5);
//   * the wage section is withheld when empty rather than showing a permanent
//     notice, because wage_payments is 0 rows all-time (D4).
// The bank half is untouched, including both bankExempt cases.

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

/* eslint-enable @typescript-eslint/no-explicit-any */

const UID = "11111111-1111-1111-1111-111111111111";

describe("WorkerHistorySections (spec 376 U3)", () => {
  it("renders the wage history newest-first and wires the receipts + bank children", () => {
    const { container } = render(
      <WorkerHistorySections uid={UID} wp={WP} payments={PAYMENTS} hasPendingBank={false} />,
    );
    expect(screen.getByText("ประวัติการจ่ายเงิน")).toBeInTheDocument();
    expect(screen.getByText(/12,000/)).toBeInTheDocument();
    // Newest period first, regardless of the order the RPC returned.
    const rows = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/12,000/);
    expect(rows[1]).toMatch(/9,000/);
    expect(screen.getByTestId("worker-bank-form")).toHaveAttribute("data-pending", "false");
  });

  // Spec 388 U2 (D5): รายการรอรับ LEFT this component for หน้าหลัก, where it sits
  // directly under the QR — it is the only write a ช่าง owns and does not belong
  // folded inside a money block.
  it("no longer carries the receipts — they mount on หน้าหลัก now", () => {
    render(<WorkerHistorySections uid={UID} wp={WP} payments={PAYMENTS} hasPendingBank={false} />);
    expect(screen.queryByText("รายการรอรับ")).not.toBeInTheDocument();
    expect(screen.queryByTestId("portal-receipts")).not.toBeInTheDocument();
  });

  // Spec 388 U2 (D4): wage_payments is 0 rows all-time (the spec-306 wall holds
  // every worker until cost-confirm), and this block now renders on หน้าหลัก —
  // the page a ช่าง actually opens. A permanent "ยังไม่มีประวัติการจ่ายเงิน" would
  // be furniture there, so the whole section is withheld until it has content,
  // and restores itself the day payroll produces a row.
  it("withholds the wage section entirely when there are no payments", () => {
    render(<WorkerHistorySections uid={UID} wp={WP} payments={[]} hasPendingBank />);
    expect(screen.queryByText("ประวัติการจ่ายเงิน")).not.toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีประวัติการจ่ายเงิน")).not.toBeInTheDocument();
    // The bank half is unaffected — it still renders, and still wires pending.
    expect(screen.getByTestId("worker-bank-form")).toHaveAttribute("data-pending", "true");
  });

  // Spec 328 U3 — a contractor-tied (pay-exempt) member never sees the bank
  // section: PRC never pays them (the firm does), so there is no bank to keep.
  // The rule rides along with the section it governs — it was asserted on
  // WorkerPortalSections before the split.
  it("hides the bank section entirely for a contractor-tied member (bankExempt)", () => {
    render(
      <WorkerHistorySections uid={UID} wp={WP} payments={[]} hasPendingBank={false} bankExempt />,
    );
    expect(screen.queryByText("บัญชีธนาคาร")).not.toBeInTheDocument();
    expect(screen.queryByTestId("worker-bank-form")).not.toBeInTheDocument();
  });

  it("keeps the bank section for a regular (non-exempt) worker", () => {
    render(<WorkerHistorySections uid={UID} wp={WP} payments={[]} hasPendingBank={false} />);
    expect(screen.getByText("บัญชีธนาคาร")).toBeInTheDocument();
    expect(screen.getByTestId("worker-bank-form")).toBeInTheDocument();
  });

  // The split's whole point: the identity half is NOT on this route.
  it("carries none of the identity half (contact + consents live on หน้าหลัก)", () => {
    render(<WorkerHistorySections uid={UID} wp={WP} payments={PAYMENTS} hasPendingBank={false} />);
    expect(screen.queryByText("ข้อมูลของฉัน")).not.toBeInTheDocument();
    expect(screen.queryByText("ความยินยอม")).not.toBeInTheDocument();
  });
});
