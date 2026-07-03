// Spec 250 U2 — the create-billing form offers an OPTIONAL งวด select scoped to
// the chosen project's contract installments. Writing failing test first.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const createClientBilling = vi.fn().mockResolvedValue({ ok: true });
vi.mock("@/app/accounting/billings/actions", () => ({
  createClientBilling: (...args: unknown[]) => createClientBilling(...args),
}));

import { CreateBillingForm } from "@/app/accounting/billings/create-billing-form";

const projects = [
  { id: "p1", label: "โครงการหนึ่ง" },
  { id: "p2", label: "โครงการสอง" },
];
const installmentsByProject = {
  p1: [
    { id: "i1", label: "งวดที่ 1 — มัดจำ", amount: 210000 },
    { id: "i2", label: "งวดที่ 2 — โครงสร้าง", amount: 420000 },
  ],
};

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: "+ สร้างงวด" }));
}

beforeEach(() => {
  createClientBilling.mockClear();
});

describe("CreateBillingForm งวด select", () => {
  it("shows the งวด select only when the chosen project has installments", () => {
    render(<CreateBillingForm projects={projects} installmentsByProject={installmentsByProject} />);
    openSheet();
    expect(screen.queryByLabelText(/งวดตามสัญญา/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p1" } });
    const select = screen.getByLabelText(/งวดตามสัญญา/);
    expect(select).toBeInTheDocument();
    // Optional: blank choice present + both งวด rows.
    expect(screen.getByRole("option", { name: /ไม่ระบุ/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /งวดที่ 1/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /งวดที่ 2/ })).toBeInTheDocument();
  });

  it("hides the select for a project without installments and clears a stale pick", () => {
    render(<CreateBillingForm projects={projects} installmentsByProject={installmentsByProject} />);
    openSheet();
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText(/งวดตามสัญญา/), { target: { value: "i1" } });
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p2" } });
    expect(screen.queryByLabelText(/งวดตามสัญญา/)).not.toBeInTheDocument();
  });

  it("submits the picked installmentId", async () => {
    render(<CreateBillingForm projects={projects} installmentsByProject={installmentsByProject} />);
    openSheet();
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("มูลค่างานในงวด (บาท)"), {
      target: { value: "210000" },
    });
    fireEvent.change(screen.getByLabelText(/งวดตามสัญญา/), { target: { value: "i1" } });
    fireEvent.submit(screen.getByRole("button", { name: "สร้างงวด (ร่าง)" }).closest("form")!);
    await vi.waitFor(() => expect(createClientBilling).toHaveBeenCalledTimes(1));
    expect(createClientBilling).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", installmentId: "i1" }),
    );
  });

  it("submits installmentId null when none picked", async () => {
    render(<CreateBillingForm projects={projects} installmentsByProject={installmentsByProject} />);
    openSheet();
    fireEvent.change(screen.getByLabelText("โครงการ"), { target: { value: "p2" } });
    fireEvent.change(screen.getByLabelText("มูลค่างานในงวด (บาท)"), {
      target: { value: "50000" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "สร้างงวด (ร่าง)" }).closest("form")!);
    await vi.waitFor(() => expect(createClientBilling).toHaveBeenCalledTimes(1));
    expect(createClientBilling).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p2", installmentId: null }),
    );
  });
});
