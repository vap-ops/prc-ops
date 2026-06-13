// Writing failing test first.
//
// Spec 73: PurchaseRequestNotes is the thin wrapper binding the editable
// purchase-request note write path onto the shared NotesField (spec 72).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSet, mockRefresh } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/requests/[requestId]/notes-actions", () => ({
  setPurchaseRequestNotes: mockSet,
}));

import { PurchaseRequestNotes } from "@/components/features/purchase-request-notes";

describe("PurchaseRequestNotes", () => {
  beforeEach(() => {
    mockSet.mockReset();
    mockRefresh.mockReset();
  });

  it("seeds the textarea with the current note", () => {
    render(<PurchaseRequestNotes requestId="r" notes="ส่งหลังบ่ายสอง" />);
    expect(screen.getByRole("textbox")).toHaveValue("ส่งหลังบ่ายสอง");
  });

  it("relays the raw edited value to setPurchaseRequestNotes and refreshes", async () => {
    mockSet.mockResolvedValue({ ok: true });
    render(<PurchaseRequestNotes requestId="r" notes={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  ยี่ห้อ X  " } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith({ requestId: "r", notes: "  ยี่ห้อ X  " }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("surfaces the error and does not refresh on failure", async () => {
    mockSet.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์แก้ไขหมายเหตุ" });
    render(<PurchaseRequestNotes requestId="r" notes={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "z" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์แก้ไขหมายเหตุ");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
