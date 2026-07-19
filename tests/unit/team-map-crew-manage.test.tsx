// Spec 330 U3b — the crew MANAGE layer on the team map: tappable worker chips
// and a per-crew manage button, each opening a sheet whose action set is scoped
// to the node. The U1 read/collapse behaviour is covered by
// tests/unit/team-map-view.test.tsx and must keep passing untouched.
//
// Two shapes are load-bearing and pinned here:
//   * the crew card's manage control is a SIBLING of the แสดง/ซ่อน toggle, never
//     a wrapper — a wrapping button swallows the toggle into its accessible
//     name AND is invalid HTML (the real parser flattens it, so the tap region
//     would exist in jsdom and not in the browser);
//   * firm and pool cards get NO crew operations — a firm worker is pay-exempt
//     (spec 328 §2.4, walled in Postgres by mig 075818) and the pool has no crew.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockAdd, mockRemove, mockMove, mockSetLead, mockCreate, mockRename, mockDissolve } =
  vi.hoisted(() => ({
    mockAdd: vi.fn(async () => ({ ok: true, id: "x" })),
    mockRemove: vi.fn(async () => ({ ok: true, id: "x" })),
    mockMove: vi.fn(async () => ({ ok: true, id: "x" })),
    mockSetLead: vi.fn(async () => ({ ok: true, id: "x" })),
    mockCreate: vi.fn(async () => ({ ok: true, id: "x" })),
    mockRename: vi.fn(async () => ({ ok: true, id: "x" })),
    mockDissolve: vi.fn(async () => ({ ok: true, id: "x" })),
  }));

vi.mock("@/lib/team-map/crew-actions", () => ({
  addWorkerToCrew: mockAdd,
  removeWorkerFromCrew: mockRemove,
  moveWorkerBetweenCrews: mockMove,
  setCrewLead: mockSetLead,
  createCrew: mockCreate,
  renameCrew: mockRename,
  dissolveCrew: mockDissolve,
}));
vi.mock("@/app/projects/[projectId]/settings/actions", () => ({
  addProjectMember: vi.fn(async () => ({ ok: true })),
  removeProjectMember: vi.fn(async () => ({ ok: true })),
  setPrimaryProjectFor: vi.fn(async () => ({ ok: true })),
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

import { TeamMapView } from "@/components/features/team-map/team-map-view";
import type { ProjectTeamMap } from "@/lib/team-map/build-team-map";

const PROJECT = "11111111-1111-4111-8111-111111111111";

const MAP: ProjectTeamMap = {
  management: [],
  site: [],
  teams: [
    {
      kind: "crew",
      id: "cr-1",
      name: "ทีมปูน",
      members: [
        { workerId: "w-lead", name: "แก้ว บุญวัง", isTeamLead: true, contractorId: null },
        { workerId: "w-a", name: "ภานุพงษ์", isTeamLead: false, contractorId: null },
      ],
      count: 2,
    },
    {
      kind: "crew",
      id: "cr-2",
      name: "ทีมเหล็ก",
      members: [
        { workerId: "w-b", name: "สมหวัง", isTeamLead: false, contractorId: null },
        // ⭐ A contractor-tied worker sitting INSIDE a crew card. This is the
        // fixture that makes the money wall testable: `kind` reads "crew" here,
        // so a wall keyed on the card's kind (rather than the chip's own
        // contractorId) would wave this worker straight through — and every
        // firm-card assertion would still pass. A pre-wall row like this can
        // only exist from before mig 075818, which is exactly why the UI must
        // still offer removal for it.
        { workerId: "w-firm-in-crew", name: "ประสงค์", isTeamLead: false, contractorId: "f-1" },
      ],
      count: 2,
    },
    {
      kind: "firm",
      id: "f-1",
      name: "ทีมช่างอวย",
      members: [{ workerId: "w-firm", name: "อวย", isTeamLead: false, contractorId: "f-1" }],
      count: 1,
    },
    {
      kind: "unassigned",
      id: "unassigned",
      name: "ยังไม่จัดทีม",
      members: [{ workerId: "w-loose", name: "สงกรานต์", isTeamLead: false, contractorId: null }],
      count: 1,
    },
  ],
  crewTotal: 5,
  teamCount: 3,
  memberCount: 2,
};

function renderView() {
  return render(
    <TeamMapView projectId={PROJECT} map={MAP} addableStaff={[]} currentUserId="u-pm" />,
  );
}

async function expand(user: ReturnType<typeof userEvent.setup>, cardId: string) {
  const card = screen.getByTestId(`team-card-${cardId}`);
  await user.click(within(card).getByRole("button", { name: /แสดง/ }));
  return card;
}

afterEach(() => {
  cleanup();
  for (const m of [
    mockAdd,
    mockRemove,
    mockMove,
    mockSetLead,
    mockCreate,
    mockRename,
    mockDissolve,
  ])
    m.mockClear();
});

describe("team map — crew manage (spec 330 U3b)", () => {
  it("the crew manage control is a SIBLING of the toggle, not a wrapper", async () => {
    const user = userEvent.setup();
    renderView();
    const card = screen.getByTestId("team-card-cr-1");
    // The U1 toggle query must still resolve to exactly one element.
    const toggle = within(card).getByRole("button", { name: /แสดง/ });
    const manage = within(card).getByRole("button", { name: /จัดการทีม/ });
    expect(manage).not.toContainElement(toggle);
    expect(toggle).not.toContainElement(manage);
    await user.click(manage);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("firm and pool cards expose NO crew manage control", () => {
    renderView();
    expect(
      within(screen.getByTestId("team-card-f-1")).queryByRole("button", { name: /จัดการทีม/ }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("team-card-unassigned")).queryByRole("button", {
        name: /จัดการทีม/,
      }),
    ).not.toBeInTheDocument();
  });

  it("team sheet renames the crew through the action", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(screen.getByTestId("team-card-cr-1")).getByRole("button", { name: /จัดการทีม/ }),
    );
    const input = screen.getByRole("textbox", { name: /ชื่อทีม/ });
    await user.clear(input);
    await user.type(input, "ทีมปูนใหม่");
    await user.click(screen.getByRole("button", { name: /บันทึกชื่อ/ }));
    expect(mockRename).toHaveBeenCalledWith(
      expect.objectContaining({ crewId: "cr-1", name: "ทีมปูนใหม่" }),
    );
  });

  // Clearing the field used to fall back to `crewName || teamSheet.name`, so a
  // cleared box re-sent the crew's existing name: the user saw a success toast
  // and an audit row was written for a rename that changed nothing.
  it("clearing the name sends the blank through, never the old name", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(screen.getByTestId("team-card-cr-1")).getByRole("button", { name: /จัดการทีม/ }),
    );
    await user.clear(screen.getByRole("textbox", { name: /ชื่อทีม/ }));
    await user.click(screen.getByRole("button", { name: /บันทึกชื่อ/ }));
    expect(mockRename).toHaveBeenCalledWith(expect.objectContaining({ crewId: "cr-1", name: "" }));
  });

  // Every sheet opens through openSheet(), which reseeds the name field and
  // clears the error. Setting sheet state directly leaked one sheet's typed
  // name into the next one.
  it("the name field is reseeded per sheet and never leaks between sheets", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(screen.getByTestId("team-card-cr-1")).getByRole("button", { name: /จัดการทีม/ }),
    );
    const first = screen.getByRole("textbox", { name: /ชื่อทีม/ });
    expect(first).toHaveValue("ทีมปูน");
    await user.clear(first);
    await user.type(first, "พิมพ์ทิ้งไว้");
    await user.click(screen.getByRole("button", { name: /ปิด/ }));

    await user.click(
      within(screen.getByTestId("team-card-cr-2")).getByRole("button", { name: /จัดการทีม/ }),
    );
    expect(screen.getByRole("textbox", { name: /ชื่อทีม/ })).toHaveValue("ทีมเหล็ก");
  });

  it("team sheet dissolves the crew behind a confirm", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      within(screen.getByTestId("team-card-cr-1")).getByRole("button", { name: /จัดการทีม/ }),
    );
    await user.click(screen.getByRole("button", { name: /ยุบทีม/ }));
    expect(mockDissolve).not.toHaveBeenCalled(); // confirm first
    await user.click(screen.getByRole("button", { name: /ยืนยันยุบทีม/ }));
    expect(mockDissolve).toHaveBeenCalledWith(expect.objectContaining({ crewId: "cr-1" }));
  });

  it("a crew worker chip opens a sheet with lead / move / remove", async () => {
    const user = userEvent.setup();
    renderView();
    const card = await expand(user, "cr-1");
    await user.click(within(card).getByRole("button", { name: /ภานุพงษ์/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: /ตั้งเป็นหัวหน้าทีม/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /นำออกจากทีม/ })).toBeInTheDocument();
    // The move picker offers OTHER crews only — never a firm or the pool.
    expect(within(sheet).getByRole("button", { name: /ทีมเหล็ก/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /ทีมช่างอวย/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /ยังไม่จัดทีม/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /ทีมปูน/ })).not.toBeInTheDocument();
  });

  it("chip actions relay to the crew RPCs with the right ids", async () => {
    const user = userEvent.setup();
    renderView();
    const card = await expand(user, "cr-1");
    await user.click(within(card).getByRole("button", { name: /ภานุพงษ์/ }));
    await user.click(screen.getByRole("button", { name: /ตั้งเป็นหัวหน้าทีม/ }));
    expect(mockSetLead).toHaveBeenCalledWith(
      expect.objectContaining({ crewId: "cr-1", workerId: "w-a" }),
    );

    const card2 = screen.getByTestId("team-card-cr-1");
    await user.click(within(card2).getByRole("button", { name: /ภานุพงษ์/ }));
    await user.click(screen.getByRole("button", { name: /ทีมเหล็ก/ }));
    expect(mockMove).toHaveBeenCalledWith(
      expect.objectContaining({ fromCrewId: "cr-1", toCrewId: "cr-2", workerId: "w-a" }),
    );
  });

  it("a POOL worker chip offers add-to-crew, never remove or lead", async () => {
    const user = userEvent.setup();
    renderView();
    const card = await expand(user, "unassigned");
    await user.click(within(card).getByRole("button", { name: /สงกรานต์/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: /นำออกจากทีม/ })).not.toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: /ตั้งเป็นหัวหน้าทีม/ }),
    ).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /ทีมปูน/ }));
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ crewId: "cr-1", workerId: "w-loose" }),
    );
  });

  it("a FIRM worker chip offers no crew operation at all (money wall)", async () => {
    const user = userEvent.setup();
    renderView();
    const card = await expand(user, "f-1");
    await user.click(within(card).getByRole("button", { name: /อวย/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: /ทีมปูน/ })).not.toBeInTheDocument();
    expect(
      within(sheet).queryByRole("button", { name: /ตั้งเป็นหัวหน้าทีม/ }),
    ).not.toBeInTheDocument();
    expect(within(sheet).getByText(/ผู้รับเหมา/)).toBeInTheDocument();
  });

  // The wall must key on the CHIP's contractorId, not the card's kind. In a
  // firm card the two agree, so a kind-keyed wall passes that test with the
  // real check deleted. Here they disagree.
  it("a contractor-tied worker INSIDE a crew card gets no add/move/lead", async () => {
    const user = userEvent.setup();
    renderView();
    const card = await expand(user, "cr-2");
    await user.click(within(card).getByRole("button", { name: /ประสงค์/ }));
    const sheet = screen.getByRole("dialog");
    expect(
      within(sheet).queryByRole("button", { name: /ตั้งเป็นหัวหน้าทีม/ }),
    ).not.toBeInTheDocument();
    // ทีมปูน is the other crew — the move target that must NOT be offered.
    expect(within(sheet).queryByRole("button", { name: /ทีมปูน/ })).not.toBeInTheDocument();
    expect(within(sheet).getByText(/ผู้รับเหมา/)).toBeInTheDocument();
  });

  // The DB deliberately leaves removal open (spec 330 U3a §F: "never trap a
  // row"). The UI must not be stricter than the DB here, or a pre-wall
  // membership becomes unremovable from the only screen that manages crews.
  it("a contractor-tied worker inside a crew CAN still be removed", async () => {
    const user = userEvent.setup();
    renderView();
    const card = await expand(user, "cr-2");
    await user.click(within(card).getByRole("button", { name: /ประสงค์/ }));
    await user.click(screen.getByRole("button", { name: /นำออกจากทีม/ }));
    expect(mockRemove).toHaveBeenCalledWith(
      expect.objectContaining({ crewId: "cr-2", workerId: "w-firm-in-crew" }),
    );
  });

  it("ตั้งทีม creates a crew from the add sheet", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /เพิ่มสมาชิก/ }));
    await user.click(screen.getByRole("button", { name: /ตั้งทีมใหม่/ }));
    const input = screen.getByRole("textbox", { name: /ชื่อทีม/ });
    await user.type(input, "ทีมใหม่");
    await user.click(screen.getByRole("button", { name: /สร้างทีม/ }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, name: "ทีมใหม่" }),
    );
  });
});
