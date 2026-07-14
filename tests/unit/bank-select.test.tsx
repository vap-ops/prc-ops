// Spec 317 U7 — BankSelect: the shared ชื่อธนาคาร picker (chips with monogram
// icons, usage-frequency order via the bank_name_usage RPC, อื่นๆ free-text
// escape). Replaces free-text bank inputs on every bank form so stored names
// stay canonical.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock("@/lib/db/browser", () => ({ createClient: () => ({ rpc: mockRpc }) }));

import { BankSelect } from "@/components/features/common/bank-select";
import { THAI_BANKS } from "@/lib/banks/thai-banks";

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("BankSelect", () => {
  it("renders a chip per bank (monogram + name) plus the อื่นๆ escape", async () => {
    render(<BankSelect value="" onChange={() => {}} />);
    for (const b of THAI_BANKS.slice(0, 4)) {
      expect(screen.getByRole("button", { name: new RegExp(b.name) })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /อื่นๆ/ })).toBeInTheDocument();
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith("bank_name_usage"));
  });

  it("emits the canonical name when a chip is tapped and marks it selected", () => {
    const onChange = vi.fn();
    const { rerender } = render(<BankSelect value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
    expect(onChange).toHaveBeenCalledWith("กสิกรไทย");
    rerender(<BankSelect value="กสิกรไทย" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /กสิกรไทย/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("อื่นๆ reveals a free-text input that feeds onChange", () => {
    const onChange = vi.fn();
    render(<BankSelect value="" onChange={onChange} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /อื่นๆ/ }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "ธนาคารท้องถิ่น" } });
    expect(onChange).toHaveBeenCalledWith("ธนาคารท้องถิ่น");
  });

  it("a non-canonical stored value opens in อื่นๆ mode prefilled", () => {
    render(<BankSelect value="ธนาคารท้องถิ่น" onChange={() => {}} />);
    expect(screen.getByDisplayValue("ธนาคารท้องถิ่น")).toBeInTheDocument();
  });

  it("reorders chips by fetched usage counts", async () => {
    mockRpc.mockResolvedValue({
      data: [{ bank_name: "ออมสิน", uses: 7 }],
      error: null,
    });
    render(<BankSelect value="" onChange={() => {}} />);
    await waitFor(() => {
      const chips = screen.getAllByRole("button");
      expect(chips[0]?.textContent).toContain("ออมสิน");
    });
  });
});
