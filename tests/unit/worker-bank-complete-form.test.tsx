// Writing failing test first.
//
// Spec 298 U3 — the PM transcription form: the approver sees the SA-captured passbook
// (a signed image) beside three fields (ธนาคาร / เลขที่บัญชี / ชื่อบัญชี) and saves via
// completeWorkerBank. On success the row is refreshed away. Pins the render + gating +
// submit wiring; the action is mocked.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const completeWorkerBank = vi.fn();
vi.mock("@/app/registrations/awaiting-bank/actions", () => ({
  completeWorkerBank: (...args: unknown[]) => completeWorkerBank(...args),
}));

import { WorkerBankCompleteForm } from "@/components/features/register/worker-bank-complete-form";

const row = {
  workerId: "w1",
  name: "สมชาย ช่างดี",
  employeeId: "PRC-26-0001",
  photoUrl: "https://signed.example/passbook.jpg",
};

function fill() {
  fireEvent.change(screen.getByLabelText(/^ธนาคาร/), { target: { value: "ธ.กรุงเทพ" } });
  fireEvent.change(screen.getByLabelText(/เลขที่บัญชี/), { target: { value: "1234567890" } });
  fireEvent.change(screen.getByLabelText(/ชื่อบัญชี/), { target: { value: "สมชาย ช่างดี" } });
}

describe("WorkerBankCompleteForm — spec 298 U3", () => {
  it("shows the worker + passbook image and disables submit until all fields are filled", () => {
    render(<WorkerBankCompleteForm row={row} />);
    expect(screen.getByText(/สมชาย ช่างดี/)).toBeInTheDocument();
    expect(screen.getByText(/PRC-26-0001/)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", row.photoUrl);
    const submit = screen.getByRole("button", { name: /บันทึกบัญชี/ });
    expect(submit).toBeDisabled();
    fill();
    expect(submit).toBeEnabled();
  });

  it("saves the transcription via completeWorkerBank", async () => {
    completeWorkerBank.mockResolvedValue({ ok: true });
    render(<WorkerBankCompleteForm row={row} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /บันทึกบัญชี/ }));
    await waitFor(() =>
      expect(completeWorkerBank).toHaveBeenCalledWith({
        workerId: "w1",
        bankName: "ธ.กรุงเทพ",
        accountNumber: "1234567890",
        accountName: "สมชาย ช่างดี",
      }),
    );
  });
});
