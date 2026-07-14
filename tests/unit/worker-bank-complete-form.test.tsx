// Writing failing test first.
//
// Spec 298 U3 — the PM transcription form: the approver sees the SA-captured passbook
// (a signed image) beside the bank picker (spec 317 U7 BankSelect) + two fields
// (เลขที่บัญชี / ชื่อบัญชี) and saves via completeWorkerBank. On success the row is
// refreshed away. Pins the render + gating + submit wiring; the action is mocked.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// BankSelect fetches bank_name_usage on mount via the browser client.
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) }),
}));

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
  fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
  fireEvent.change(screen.getByLabelText(/เลขที่บัญชี/), { target: { value: "1234567890" } });
  fireEvent.change(screen.getByLabelText(/ชื่อบัญชี/), { target: { value: "สมชาย ช่างดี" } });
}

describe("WorkerBankCompleteForm — spec 298 U3", () => {
  it("shows the worker + passbook image and disables submit until all fields are filled", async () => {
    render(<WorkerBankCompleteForm row={row} />);
    // findBy flushes BankSelect's mount-time usage fetch (avoids an act warning).
    await screen.findByRole("button", { name: /กสิกรไทย/ });
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
        bankName: "กสิกรไทย",
        accountNumber: "1234567890",
        accountName: "สมชาย ช่างดี",
      }),
    );
  });
});
