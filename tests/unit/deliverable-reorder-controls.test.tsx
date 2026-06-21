// Writing failing test first.
//
// Spec 165 U2 — ▲▼ reorder controls per งวด row. PM/super/director swap a งวด
// with its neighbour; the swapDeliverableOrder action (swap_deliverable_order
// RPC) is the load-bearing path. Ends are disabled (no neighbour to swap with).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSwap, mockRefresh } = vi.hoisted(() => ({
  mockSwap: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/actions", () => ({ swapDeliverableOrder: mockSwap }));

import { DeliverableReorderControls } from "@/app/projects/[projectId]/deliverable-reorder-controls";

beforeEach(() => {
  mockSwap.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("DeliverableReorderControls", () => {
  it("disables up at the top and down at the bottom", () => {
    const { rerender } = render(
      <DeliverableReorderControls
        projectId="p1"
        deliverableId="d2"
        code="D02"
        prevId="d1"
        nextId={null}
      />,
    );
    expect(screen.getByRole("button", { name: /เลื่อนงวด D02 ขึ้น/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /เลื่อนงวด D02 ลง/ })).toBeDisabled();

    rerender(
      <DeliverableReorderControls
        projectId="p1"
        deliverableId="d1"
        code="D01"
        prevId={null}
        nextId="d2"
      />,
    );
    expect(screen.getByRole("button", { name: /เลื่อนงวด D01 ขึ้น/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /เลื่อนงวด D01 ลง/ })).toBeEnabled();
  });

  it("swaps with the previous งวด on up and refreshes", async () => {
    render(
      <DeliverableReorderControls
        projectId="p1"
        deliverableId="d2"
        code="D02"
        prevId="d1"
        nextId={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /เลื่อนงวด D02 ขึ้น/ }));
    await waitFor(() => expect(mockSwap).toHaveBeenCalledWith("p1", "d2", "d1"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("swaps with the next งวด on down", async () => {
    render(
      <DeliverableReorderControls
        projectId="p1"
        deliverableId="d1"
        code="D01"
        prevId={null}
        nextId="d2"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /เลื่อนงวด D01 ลง/ }));
    await waitFor(() => expect(mockSwap).toHaveBeenCalledWith("p1", "d1", "d2"));
  });
});
