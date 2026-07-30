// Writing failing test first.
//
// Spec 266 U7 (option C) — the ช่าง gets their OWN portal at /technician (not the
// subcontractor /portal). WorkerPortalSections is the worker-portal content
// extracted from /portal so /technician can host it and /portal reverts to
// subcontractor-only.
//
// Spec 376 U3 (D3) — reduced surface. This component is now the IDENTITY half
// only (ข้อมูลของฉัน contact + tax id, ความยินยอม); the money half moved to
// WorkerHistorySections on the ประวัติ route. Six assertions left this file with
// it — ประวัติการจ่ายเงิน, /12,000/, ยังไม่มีประวัติการจ่ายเงิน, both
// worker-bank-form data-pending pins, and the two bankExempt cases (which is why
// two whole cases below are gone) — and all six now live in
// worker-history-sections.test.tsx. Nothing was dropped; the tax-id + child-wiring
// assertions stayed because their sections stayed.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The client child components are tested on their own — mock them so this test
// isolates WorkerPortalSections' own logic (tax id, child wiring).
// Spec 321 U3b — the worker contact block is now the shared ProfileContactSection
// (read card + edit-in-sheet, decision 6), hosting WorkerProfileEdit inside.
vi.mock("@/components/features/profile/profile-contact-section", () => ({
  ProfileContactSection: ({ audience }: { audience: string }) => (
    <div data-testid="profile-contact-section" data-audience={audience} />
  ),
}));
vi.mock("@/components/features/portal/worker-consents", () => ({
  WorkerConsents: () => <div data-testid="worker-consents" />,
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
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("WorkerPortalSections", () => {
  it("renders the ช่าง's tax id and wires the child sections", () => {
    render(<WorkerPortalSections wp={WP} consents={[]} />);
    expect(screen.getByText("ข้อมูลของฉัน")).toBeInTheDocument();
    // tax id shows when present
    expect(screen.getByText("1234567890123")).toBeInTheDocument();
    // children wired
    expect(screen.getByTestId("profile-contact-section")).toHaveAttribute(
      "data-audience",
      "worker",
    );
    expect(screen.getByTestId("worker-consents")).toBeInTheDocument();
  });

  // Spec 376 U3 — the money half is NOT here any more. Pinned as an ABSENCE so a
  // future edit cannot quietly re-stack the two halves onto หน้าหลัก (which is the
  // long-scroll page the split exists to end).
  it("carries none of the money half (receipts, wage history, bank)", () => {
    render(<WorkerPortalSections wp={WP} consents={[]} />);
    expect(screen.queryByText("รายการรอรับ")).not.toBeInTheDocument();
    expect(screen.queryByText("ประวัติการจ่ายเงิน")).not.toBeInTheDocument();
    expect(screen.queryByText("บัญชีธนาคาร")).not.toBeInTheDocument();
  });
});
