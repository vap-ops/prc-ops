// Writing failing test first.
//
// Spec 198 U2 / ADR 0064 — divert a delivered WP-bound line into the store. The
// คลัง lists the project's delivered, WP-bound, catalogued purchase lines not yet
// diverted; each can be moved into store stock (ย้ายเข้าคลัง), transferring its
// cost WP-WIP → Inventory via divert_purchase_to_store. Per-line confirm; the
// item/qty/cost are fixed from the PR (no editing).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDivert, mockRefresh } = vi.hoisted(() => ({
  mockDivert: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("@/app/store/actions", () => ({ divertPurchaseToStore: mockDivert }));

import {
  DivertToStoreList,
  type DivertLine,
} from "@/components/features/store/divert-to-store-list";

const lines: DivertLine[] = [
  {
    requestId: "pr1",
    itemLabel: "ปูนซีเมนต์",
    qty: 50,
    unit: "ถุง",
    wpLabel: "WP-01 งานเดินไฟ",
    cost: 6500,
  },
];

beforeEach(() => {
  mockDivert.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("DivertToStoreList (spec 198 U2)", () => {
  it("lists each delivered WP-bound line with item, qty and source WP", () => {
    render(<DivertToStoreList lines={lines} />);
    expect(screen.getByText("ปูนซีเมนต์")).toBeInTheDocument();
    expect(screen.getByText(/WP-01/)).toBeInTheDocument();
    expect(screen.getByText(/50\s*ถุง/)).toBeInTheDocument();
  });

  it("diverts a line into the store after confirm", async () => {
    render(<DivertToStoreList lines={lines} />);
    fireEvent.click(screen.getByRole("button", { name: /ย้ายเข้าคลัง/ }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(mockDivert).toHaveBeenCalledWith({ requestId: "pr1" }));
    // ConfirmActionButton refreshes on success.
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("renders nothing when there are no divertible lines", () => {
    const { container } = render(<DivertToStoreList lines={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
