// Writing failing test first.
//
// Spec 88: ContactBankBlock — the PM-only bank editor on the contact detail page.
// Initial values come from the server (admin read of contact_bank); save goes
// through the setContactBank action (the SECURITY DEFINER RPC under the hood).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockRefresh } = vi.hoisted(() => ({ mockSet: vi.fn(), mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/contacts/actions", () => ({ setContactBank: mockSet }));

import { ContactBankBlock } from "@/components/features/contact-bank-block";

beforeEach(() => {
  mockSet.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("ContactBankBlock", () => {
  it("shows the initial bank values", () => {
    render(
      <ContactBankBlock
        kind="contractor"
        id="c1"
        initial={{ bankName: "ธ.กสิกร", bankAccountNo: "123", bankAccountName: "นายเอ" }}
      />,
    );
    expect(screen.getByDisplayValue("ธ.กสิกร")).toBeInTheDocument();
    expect(screen.getByDisplayValue("123")).toBeInTheDocument();
  });

  it("saves via setContactBank with the kind + id", async () => {
    render(<ContactBankBlock kind="supplier" id="s1" initial={null} />);
    fireEvent.change(screen.getByLabelText("ชื่อธนาคาร"), {
      target: { value: "ธ.ไทยพาณิชย์" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลธนาคาร" }));
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "supplier", id: "s1", bankName: "ธ.ไทยพาณิชย์" }),
      ),
    );
  });
});
