// Spec 72: the project settings form has a notes textarea, batched into its
// single save. Spec 79: it also carries site address, dates, type, lead,
// budget, and client — all sent in one payload.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockCreateClient, mockRefresh, mockRemoveMember } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockCreateClient: vi.fn(),
  mockRefresh: vi.fn(),
  mockRemoveMember: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/settings/actions", () => ({
  updateProjectSettings: mockUpdate,
  createClient: mockCreateClient,
  addProjectMember: vi.fn(),
  removeProjectMember: mockRemoveMember,
}));

import { SettingsForm } from "@/app/projects/[projectId]/settings/settings-form";

// Spec-79 props default to empty so each test sets only what it asserts.
const baseProps = {
  projectId: "p",
  initialName: "ชื่อเดิม",
  initialStatus: "active" as const,
  initialNotes: null as string | null,
  initialSiteAddress: null,
  initialGmapUrl: null,
  contractReference: null,
  initialStartDate: null,
  initialPlannedCompletionDate: null,
  initialClientId: null,
  initialProjectLeadId: null,
  initialProjectType: null,
  initialBudget: null,
  clients: [],
  staff: [],
  members: [],
  currentUserId: "me",
};

describe("SettingsForm", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockCreateClient.mockReset();
    mockRefresh.mockReset();
    mockRemoveMember.mockReset();
    mockRemoveMember.mockResolvedValue({ ok: true });
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
        gmapUrl: "",
        startDate: "",
        plannedCompletionDate: "",
        projectType: "",
        projectLeadId: "",
        budgetAmount: "",
        clientId: "",
      }),
    );
  });

  // Spec 192: membership safety net.
  it("disables removing the last member (project must keep ≥1)", () => {
    render(
      <SettingsForm {...baseProps} members={[{ id: "me", name: "ฉัน" }]} currentUserId="me" />,
    );
    expect(screen.getByRole("button", { name: "ลบ ฉัน" })).toBeDisabled();
  });

  it("confirms before removing YOURSELF, then calls the action", async () => {
    render(
      <SettingsForm
        {...baseProps}
        members={[
          { id: "me", name: "ฉัน" },
          { id: "u2", name: "อีกคน" },
        ]}
        currentUserId="me"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ลบ ฉัน" }));
    // A consequence confirm appears; the action has NOT fired yet.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockRemoveMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "นำออก" }));
    await waitFor(() => expect(mockRemoveMember).toHaveBeenCalledWith("p", "me"));
  });

  it("removes another member with no confirm dialog", async () => {
    render(
      <SettingsForm
        {...baseProps}
        members={[
          { id: "me", name: "ฉัน" },
          { id: "u2", name: "อีกคน" },
        ]}
        currentUserId="me"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ลบ อีกคน" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(mockRemoveMember).toHaveBeenCalledWith("p", "u2"));
  });

  // Spec 174: the pasted Google-Maps link rides the same single save.
  it("seeds and submits the Google-Maps link", async () => {
    mockUpdate.mockResolvedValue({ ok: true });
    render(<SettingsForm {...baseProps} initialGmapUrl="https://maps.app.goo.gl/seed" />);
    const field = screen.getByLabelText("ลิงก์ Google Maps");
    expect(field).toHaveValue("https://maps.app.goo.gl/seed");
    fireEvent.change(field, { target: { value: "https://maps.app.goo.gl/edited" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการตั้งค่า" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ gmapUrl: "https://maps.app.goo.gl/edited" }),
      ),
    );
  });
});
