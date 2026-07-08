// Writing failing test first.
//
// Spec 264 follow-up (site assignment at approval) — RegistrationDecision gains
// an OPTIONAL site/project selector beside the role selector. Default option is
// empty (unassigned); picking a project threads its id through to
// approveStaffRegistration as projectId; leaving it unselected sends null.
// Shown unconditionally (harmless no-op for office roles — the RPC only honors
// p_project_id for a field role) rather than gated on the chosen role, per the
// operator's "your call, pick the cleaner UX" — always-visible is simpler and
// the selector still defaults to the field-role case (technician).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApprove, mockReject, mockRefresh } = vi.hoisted(() => ({
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/registrations/actions", () => ({
  approveStaffRegistration: mockApprove,
  rejectStaffRegistration: mockReject,
}));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { RegistrationDecision } from "@/components/features/registrations/registration-decision";

const PROJECTS = [
  { id: "p1", code: "PRJ-01", name: "โครงการหนึ่ง" },
  { id: "p2", code: "PRJ-02", name: "โครงการสอง" },
];

beforeEach(() => {
  mockApprove.mockReset().mockResolvedValue({ ok: true });
  mockReject.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("RegistrationDecision — site assignment selector", () => {
  it("renders a site selector with an empty default option", () => {
    render(<RegistrationDecision registrationId="reg-1" projects={PROJECTS} />);
    const select = screen.getByLabelText("มอบหมายให้ไซต์งาน (ถ้ามี)") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByText("— ไม่ระบุไซต์งาน (ถ้ามี) —")).toBeInTheDocument();
    expect(screen.getByText("โครงการหนึ่ง")).toBeInTheDocument();
    expect(screen.getByText("โครงการสอง")).toBeInTheDocument();
  });

  it("approves with projectId null when no site is picked", async () => {
    render(<RegistrationDecision registrationId="reg-1" projects={PROJECTS} />);
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith(
        expect.objectContaining({ registrationId: "reg-1", projectId: null }),
      ),
    );
  });

  it("approves with the selected project id", async () => {
    render(<RegistrationDecision registrationId="reg-1" projects={PROJECTS} />);
    fireEvent.change(screen.getByLabelText("มอบหมายให้ไซต์งาน (ถ้ามี)"), {
      target: { value: "p2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith(
        expect.objectContaining({ registrationId: "reg-1", projectId: "p2" }),
      ),
    );
  });

  it("still works with no projects prop passed (defensive default)", () => {
    render(<RegistrationDecision registrationId="reg-1" />);
    expect(screen.getByLabelText("มอบหมายให้ไซต์งาน (ถ้ามี)")).toBeInTheDocument();
  });
});

describe("RegistrationDecision — role selector (self-onboard: 2 field roles)", () => {
  it("offers only technician + site_admin, defaulting to technician", () => {
    render(<RegistrationDecision registrationId="reg-1" projects={PROJECTS} />);
    const roleSelect = screen.getByLabelText("มอบหมายบทบาท") as HTMLSelectElement;
    expect(Array.from(roleSelect.options).map((o) => o.value)).toEqual([
      "technician",
      "site_admin",
    ]);
    expect(roleSelect.value).toBe("technician");
  });

  it("approves as technician by default", async () => {
    render(<RegistrationDecision registrationId="reg-1" projects={PROJECTS} />);
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith(
        expect.objectContaining({ registrationId: "reg-1", role: "technician" }),
      ),
    );
  });
});

describe("RegistrationDecision — invited project pre-select (spec 279 F2b)", () => {
  it("pre-selects the invited project id so the approver can one-tap approve", () => {
    render(
      <RegistrationDecision registrationId="reg-1" projects={PROJECTS} invitedProjectId="p2" />,
    );
    expect((screen.getByLabelText("มอบหมายให้ไซต์งาน (ถ้ามี)") as HTMLSelectElement).value).toBe(
      "p2",
    );
  });

  it("defaults to empty when there is no invited project", () => {
    render(<RegistrationDecision registrationId="reg-1" projects={PROJECTS} />);
    expect((screen.getByLabelText("มอบหมายให้ไซต์งาน (ถ้ามี)") as HTMLSelectElement).value).toBe(
      "",
    );
  });

  it("approves with the pre-selected invited project id", async () => {
    render(
      <RegistrationDecision registrationId="reg-1" projects={PROJECTS} invitedProjectId="p2" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith(
        expect.objectContaining({ registrationId: "reg-1", projectId: "p2" }),
      ),
    );
  });

  // Trust-model guard: a mis-scanned / cross-project / non-active (RLS-filtered)
  // invited id is NOT a selectable option, so it must fall back to empty — the
  // visible selection and the submitted value must never diverge (else a one-tap
  // approve would silently bind the worker to an unconfirmed, visitor-supplied id).
  it("falls back to empty when the invited project is not a selectable option", () => {
    render(
      <RegistrationDecision
        registrationId="reg-1"
        projects={PROJECTS}
        invitedProjectId="p-ghost"
      />,
    );
    expect((screen.getByLabelText("มอบหมายให้ไซต์งาน (ถ้ามี)") as HTMLSelectElement).value).toBe(
      "",
    );
  });

  it("approves with projectId null for an out-of-scope invited project (never a hidden bind)", async () => {
    render(
      <RegistrationDecision
        registrationId="reg-1"
        projects={PROJECTS}
        invitedProjectId="p-ghost"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith(
        expect.objectContaining({ registrationId: "reg-1", projectId: null }),
      ),
    );
  });
});
