// Spec 72: the project settings form has a notes textarea, batched into its
// single save. Spec 79: it also carries site address, dates, type, lead,
// budget, and client — all sent in one payload.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockCreateClient, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockCreateClient: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/sa/projects/[projectId]/settings/actions", () => ({
  updateProjectSettings: mockUpdate,
  createClient: mockCreateClient,
}));

import { SettingsForm } from "@/app/sa/projects/[projectId]/settings/settings-form";

// Spec-79 props default to empty so each test sets only what it asserts.
const baseProps = {
  projectId: "p",
  initialName: "ชื่อเดิม",
  initialStatus: "active" as const,
  initialNotes: null as string | null,
  initialSiteAddress: null,
  contractReference: null,
  initialStartDate: null,
  initialPlannedCompletionDate: null,
  initialClientId: null,
  initialProjectLeadId: null,
  initialProjectType: null,
  initialBudget: null,
  clients: [],
  staff: [],
};

describe("SettingsForm", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockCreateClient.mockReset();
    mockRefresh.mockReset();
  });

  it("seeds the notes textarea from initialNotes", () => {
    render(<SettingsForm {...baseProps} initialName="N" initialNotes="โน้ตโครงการ" />);
    expect(screen.getByLabelText("หมายเหตุ")).toHaveValue("โน้ตโครงการ");
  });

  it("seeds contract reference read-only and shows the project-type / client selects", () => {
    render(<SettingsForm {...baseProps} contractReference="CT-2026-001" />);
    expect(screen.getByLabelText("หมายเลขสัญญาจ้าง")).toHaveValue("CT-2026-001");
    expect(screen.getByLabelText("ประเภทโครงการ")).toBeInTheDocument();
    expect(screen.getByLabelText("ลูกค้า / เจ้าของโครงการ")).toBeInTheDocument();
  });

  it("submits all fields together", async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    render(<SettingsForm {...baseProps} initialNotes={null} />);
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "โน้ตใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการตั้งค่า" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        projectId: "p",
        name: "ชื่อเดิม",
        status: "active",
        notes: "โน้ตใหม่",
        siteAddress: "",
        startDate: "",
        plannedCompletionDate: "",
        projectType: "",
        projectLeadId: "",
        budgetAmount: "",
        clientId: "",
      }),
    );
  });
});
