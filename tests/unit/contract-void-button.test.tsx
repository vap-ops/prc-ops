// Writing failing test first.
//
// Spec 284 U5 — the void control on a contract's detail. Voiding is irreversible
// (contract_status → 'void'), so it takes a two-step confirm before it relays U3's
// voidContract; on success it refreshes the detail.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { voidContract } = vi.hoisted(() => ({ voidContract: vi.fn() }));
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/lib/legal/contracts", () => ({ voidContract }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ContractVoidButton } from "@/components/features/legal/contract-void-button";

beforeEach(() => {
  voidContract.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("ContractVoidButton — spec 284 U5", () => {
  it("does not void until the confirm step is taken", async () => {
    render(<ContractVoidButton contractId="c-1" />);
    fireEvent.click(screen.getByRole("button", { name: "ทำให้เป็นโมฆะ" }));
    expect(voidContract).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ยืนยันการทำให้เป็นโมฆะ" }));
    });
    expect(voidContract).toHaveBeenCalledWith("c-1");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
