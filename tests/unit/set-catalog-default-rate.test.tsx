// Spec 385 U3b — the ทะเบียน default-rate control (MONEY writer). Mirrors the
// sibling set-daily-rate.test.tsx: a money-writing client component ships with
// its own write-path coverage — arg shape, the client-side negative guard, the
// refresh, and the resync-on-open that stops a stale sheet reverting another
// actor's rate.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetRate, mockRefresh } = vi.hoisted(() => ({
  mockSetRate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/equipment/actions", () => ({
  setEquipmentCatalogDefaultRate: mockSetRate,
}));

import { SetCatalogDefaultRate } from "@/components/features/equipment/set-catalog-default-rate";

beforeEach(() => {
  mockSetRate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("SetCatalogDefaultRate", () => {
  it("shows the current rate through the money-format SSOT, or the set door when unset", () => {
    const { unmount } = render(<SetCatalogDefaultRate skuId="s1" currentRate={300} />);
    expect(screen.getByText(/฿300/)).toBeInTheDocument();
    unmount();

    render(<SetCatalogDefaultRate skuId="s1" currentRate={null} />);
    expect(screen.getByText("ตั้งค่าเช่า/วัน")).toBeInTheDocument();
  });

  it("saves through the action with the SKU id and the typed rate, then refreshes", async () => {
    render(<SetCatalogDefaultRate skuId="s1" currentRate={null} />);
    fireEvent.click(screen.getByText("ตั้งค่าเช่า/วัน"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "ค่าเช่า/วัน" }), {
      target: { value: "250" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(mockSetRate).toHaveBeenCalledWith({ id: "s1", rate: 250 }));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("refuses a blank or negative rate client-side — the action is never called", async () => {
    render(<SetCatalogDefaultRate skuId="s1" currentRate={null} />);
    fireEvent.click(screen.getByText("ตั้งค่าเช่า/วัน"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("spinbutton", { name: "ค่าเช่า/วัน" }), {
      target: { value: "-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(mockSetRate).not.toHaveBeenCalled();
  });

  it("surfaces a refused write as an alert and keeps the sheet open", async () => {
    mockSetRate.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์ตั้งค่าเช่าอุปกรณ์" });
    render(<SetCatalogDefaultRate skuId="s1" currentRate={null} />);
    fireEvent.click(screen.getByText("ตั้งค่าเช่า/วัน"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "ค่าเช่า/วัน" }), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์ตั้งค่าเช่าอุปกรณ์"),
    );
    expect(screen.getByRole("spinbutton", { name: "ค่าเช่า/วัน" })).toBeInTheDocument();
  });

  it("reopening resyncs the input from the CURRENT rate — a stale sheet must not revert", () => {
    const { rerender } = render(<SetCatalogDefaultRate skuId="s1" currentRate={100} />);
    fireEvent.click(screen.getByText(/฿100/));
    fireEvent.change(screen.getByRole("spinbutton", { name: "ค่าเช่า/วัน" }), {
      target: { value: "111" },
    });
    // Abandon; another actor changes the rate to 200 (router.refresh → new prop).
    fireEvent.click(screen.getByRole("button", { name: "ปิด" }));
    rerender(<SetCatalogDefaultRate skuId="s1" currentRate={200} />);
    fireEvent.click(screen.getByText(/฿200/));
    expect(screen.getByRole("spinbutton", { name: "ค่าเช่า/วัน" })).toHaveValue(200);
  });
});
