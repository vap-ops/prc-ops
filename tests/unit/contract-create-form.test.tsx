// Writing failing test first.
//
// Spec 284 U5 — the contract create form (/legal/contracts). Gates on the two
// required fields (counterparty name + title), maps the inputs onto U3's
// createContract (omitting untouched optionals — project / amount), and on success
// navigates to the new contract's detail. The RPC is the real guard; this pins the
// UI wiring (arg mapping + the required-field gate).

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createContract } = vi.hoisted(() => ({ createContract: vi.fn() }));
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/legal/contracts", () => ({ createContract }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { ContractCreateForm } from "@/components/features/legal/contract-create-form";

beforeEach(() => {
  createContract.mockReset().mockResolvedValue({ ok: true, id: "c-9" });
  push.mockReset();
});

describe("ContractCreateForm — spec 284 U5", () => {
  it("keeps create disabled until counterparty name + title are filled", () => {
    render(<ContractCreateForm projects={[]} />);
    const btn = screen.getByRole("button", { name: "สร้างสัญญา" });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("ชื่อคู่สัญญา"), { target: { value: "ACME Co" } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("ชื่อสัญญา"), { target: { value: "MSA" } });
    expect(btn).toBeEnabled();
  });

  it("creates with mapped fields (omitting empty project/amount) and navigates to the new contract", async () => {
    render(<ContractCreateForm projects={[]} />);
    fireEvent.change(screen.getByLabelText("ชื่อคู่สัญญา"), { target: { value: "ACME Co" } });
    fireEvent.change(screen.getByLabelText("ชื่อสัญญา"), { target: { value: "MSA" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "สร้างสัญญา" }));
    });

    expect(createContract).toHaveBeenCalledWith({
      counterpartyType: "client",
      counterpartyName: "ACME Co",
      contractType: "client_agreement",
      title: "MSA",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/legal/contracts/c-9"));
  });
});
