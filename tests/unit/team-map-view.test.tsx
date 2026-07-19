// Spec 330 U1 — TeamMapView: tier rendering, collapse toggles that keep counts
// visible, and the staff manage sheet over the existing member actions.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeamMapView } from "@/components/features/team-map/team-map-view";
import type { ProjectTeamMap } from "@/lib/team-map/build-team-map";

const { mockAdd, mockRemove, mockSetPrimary } = vi.hoisted(() => ({
  mockAdd: vi.fn(async () => ({ ok: true })),
  mockRemove: vi.fn(async () => ({ ok: true })),
  mockSetPrimary: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/projects/[projectId]/settings/actions", () => ({
  addProjectMember: mockAdd,
  removeProjectMember: mockRemove,
  setPrimaryProjectFor: mockSetPrimary,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

const MAP: ProjectTeamMap = {
  management: [
    {
      userId: "u-pm",
      name: "สมชาย ใจดี",
      role: "project_manager",
      isLead: true,
      isPrimary: false,
      isMember: true,
    },
  ],
  site: [
    {
      userId: "u-sa1",
      name: "อรปรีญา เงางาม",
      role: "site_admin",
      isLead: false,
      isPrimary: true,
      isMember: true,
    },
    {
      userId: "u-sa2",
      name: "ประวิทย์ คงมั่น",
      role: "site_admin",
      isLead: false,
      isPrimary: false,
      isMember: true,
    },
  ],
  teams: [
    {
      kind: "crew",
      id: "cr-1",
      name: "ทีมปูน",
      members: [
        { workerId: "w-lead", name: "แก้ว บุญวัง", isTeamLead: true },
        { workerId: "w-a", name: "ภานุพงษ์", isTeamLead: false },
      ],
      count: 2,
    },
    {
      kind: "unassigned",
      id: "unassigned",
      name: "ยังไม่จัดทีม",
      members: [{ workerId: "w-loose", name: "สงกรานต์", isTeamLead: false }],
      count: 1,
    },
  ],
  crewTotal: 3,
  teamCount: 1,
  memberCount: 3,
};

function renderView(map: ProjectTeamMap = MAP) {
  return render(
    <TeamMapView
      projectId="p-1"
      map={map}
      addableStaff={[{ id: "u-new", name: "คนใหม่", role: "site_admin" }]}
      currentUserId="u-pm"
    />,
  );
}

afterEach(() => {
  cleanup();
  mockAdd.mockClear();
  mockRemove.mockClear();
  mockSetPrimary.mockClear();
});

describe("TeamMapView (spec 330 U1)", () => {
  it("renders tiers with the crew summary and collapsed member lists", () => {
    renderView();
    expect(screen.getByText(/ผู้บริหารโครงการ/)).toBeInTheDocument();
    expect(screen.getByText(/หน้างาน · /)).toBeInTheDocument();
    // Tier sum: total workers + team count, visible while collapsed.
    expect(screen.getByText(/รวม 3 คน/)).toBeInTheDocument();
    expect(screen.getByText("ทีมปูน")).toBeInTheDocument();
    // Collapsed: member chips hidden, per-card count shown.
    expect(screen.queryByText(/แก้ว บุญวัง/)).not.toBeInTheDocument();
    expect(within(screen.getByTestId("team-card-cr-1")).getByText(/2 คน/)).toBeInTheDocument();
  });

  it("แสดง toggle reveals member chips and keeps the count visible", async () => {
    const user = userEvent.setup();
    renderView();
    const crewCard = screen.getByTestId("team-card-cr-1");
    await user.click(within(crewCard).getByRole("button", { name: /แสดง/ }));
    expect(within(crewCard).getByText(/แก้ว บุญวัง/)).toBeInTheDocument();
    expect(within(crewCard).getByText(/หัวหน้าทีม/)).toBeInTheDocument();
    expect(within(crewCard).getByText(/2 คน/)).toBeInTheDocument();
  });

  it("master toggle expands every team card", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: "แสดงทั้งหมด" }));
    expect(screen.getByText(/แก้ว บุญวัง/)).toBeInTheDocument();
    expect(screen.getByText("สงกรานต์")).toBeInTheDocument();
  });

  it("tapping a staff node opens the manage sheet; SA gets the set-primary action", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /ประวิทย์ คงมั่น/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ตั้งเป็น SA หลัก/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ถอดออกจากทีมโครงการ/ })).toBeInTheDocument();
  });

  it("remove relays (projectId, userId) to removeProjectMember for another member", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /ประวิทย์ คงมั่น/ }));
    await user.click(screen.getByRole("button", { name: /ถอดออกจากทีมโครงการ/ }));
    expect(mockRemove).toHaveBeenCalledWith("p-1", "u-sa2");
  });

  it("last member: remove blocks client-side with the Thai error, no action call", async () => {
    const user = userEvent.setup();
    renderView({ ...MAP, memberCount: 1 });
    await user.click(screen.getByRole("button", { name: /ประวิทย์ คงมั่น/ }));
    await user.click(screen.getByRole("button", { name: /ถอดออกจากทีมโครงการ/ }));
    expect(mockRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/โครงการต้องมีสมาชิกอย่างน้อย 1 คน/)).toBeInTheDocument();
  });

  it("self-remove asks via ConfirmDialog first; confirm relays the action", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /สมชาย ใจดี/ }));
    await user.click(screen.getByRole("button", { name: /ถอดออกจากทีมโครงการ/ }));
    expect(mockRemove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "นำตัวเองออก" }));
    expect(mockRemove).toHaveBeenCalledWith("p-1", "u-pm");
  });

  it("เพิ่มสมาชิก opens the add sheet listing only addable staff", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /เพิ่มสมาชิก/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("คนใหม่")).toBeInTheDocument();
    expect(within(sheet).queryByText("สมชาย ใจดี")).not.toBeInTheDocument();
  });
});
