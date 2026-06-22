// Spec 177 U8 — the worker-portal receipt confirm (closes the custody loop). A
// bound worker sees the items issued TO them that are still pending receipt and
// taps "ได้รับแล้ว" to attest. Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfirm, mockRefresh } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/store/actions", () => ({ confirmStockIssue: mockConfirm }));

import { PortalReceipts, type PortalReceipt } from "@/components/features/portal/portal-receipts";

const receipts: PortalReceipt[] = [
  {
    id: "iss1",
    baseItem: "ท่อ PVC",
    specAttrs: "4 นิ้ว",
    unit: "เส้น",
    qty: 8,
    wpLabel: "WP-01 งานประปา",
  },
];

beforeEach(() => {
  mockConfirm.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("PortalReceipts (spec 177 U8)", () => {
  it("lists the items pending receipt", () => {
    render(<PortalReceipts receipts={receipts} />);
    expect(screen.getByText("ท่อ PVC")).toBeInTheDocument();
    expect(screen.getByText(/WP-01/)).toBeInTheDocument();
    expect(screen.getByText(/8\s*เส้น/)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is pending", () => {
    render(<PortalReceipts receipts={[]} />);
    expect(screen.getByText("ไม่มีรายการรอรับ")).toBeInTheDocument();
  });

  it("confirms receipt of an item", async () => {
    render(<PortalReceipts receipts={receipts} />);
    fireEvent.click(screen.getByRole("button", { name: "ได้รับแล้ว" }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith({ issueId: "iss1" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
