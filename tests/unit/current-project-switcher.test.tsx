// Spec 292 U4 — the SA current-site switcher: a chip on /sa opening a sheet of the
// SA's visible projects. Tap a row = VIEW (override cookie); "ตั้งเป็นไซต์หลัก" = pin
// (hidden on lead-only rows); a clear control reverts an active override. Renders
// nothing for an SA with <2 projects (single/zero-project SAs never needed it).
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetOverride, mockClearOverride, mockPin, mockRefresh } = vi.hoisted(() => ({
  mockSetOverride: vi.fn(async () => ({ ok: true })),
  mockClearOverride: vi.fn(async () => ({ ok: true })),
  mockPin: vi.fn((): Promise<{ ok: boolean; error?: string }> => Promise.resolve({ ok: true })),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/sa/current-project-actions", () => ({
  setActiveProjectOverride: mockSetOverride,
  clearActiveProjectOverride: mockClearOverride,
  pinPrimaryProject: mockPin,
}));

import {
  CurrentProjectSwitcher,
  type SwitcherProject,
} from "@/components/features/sa/current-project-switcher";
import type { SaCurrentProjectSource } from "@/lib/sa/current-project";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

const ALPHA: SwitcherProject = {
  id: P1,
  code: "PRC-A",
  name: "Alpha",
  isPrimary: true,
  hasMembership: true,
};
const BETA: SwitcherProject = {
  id: P2,
  code: "PRC-B",
  name: "Beta",
  isPrimary: false,
  hasMembership: true,
};
// Lead-only (visible via project_lead_id, no membership row) — viewable, NOT pinnable.
const GAMMA: SwitcherProject = {
  id: P3,
  code: "PRC-C",
  name: "Gamma",
  isPrimary: false,
  hasMembership: false,
};

const THREE = [ALPHA, BETA, GAMMA];

function renderSwitcher(
  current: { projectId: string; source: SaCurrentProjectSource },
  projects = THREE,
) {
  return render(<CurrentProjectSwitcher current={current} projects={projects} />);
}

beforeEach(() => vi.clearAllMocks());

describe("CurrentProjectSwitcher — visibility", () => {
  it("renders nothing when the SA has zero projects", () => {
    const { container } = renderSwitcher(
      { projectId: null as unknown as string, source: "none" },
      [],
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the SA has exactly ONE project", () => {
    const { container } = renderSwitcher({ projectId: P1, source: "primary" }, [ALPHA]);
    expect(container.firstChild).toBeNull();
  });
});

describe("CurrentProjectSwitcher — chip source states", () => {
  it("primary source: chip names the project with no auto/override hint", () => {
    renderSwitcher({ projectId: P1, source: "primary" });
    const chip = screen.getByRole("button", { name: /Alpha/ });
    expect(chip).toBeInTheDocument();
    expect(screen.queryByText("อัตโนมัติ")).toBeNull();
    expect(screen.queryByText("กำลังดู")).toBeNull();
  });

  it("derived source: chip shows the subtle อัตโนมัติ (auto) hint", () => {
    renderSwitcher({ projectId: P2, source: "derived" });
    expect(screen.getByRole("button", { name: /Beta/ })).toBeInTheDocument();
    expect(screen.getByText("อัตโนมัติ")).toBeInTheDocument();
  });

  it("override source: chip shows the distinct กำลังดู (viewing) state", () => {
    renderSwitcher({ projectId: P2, source: "override" });
    expect(screen.getByText("กำลังดู")).toBeInTheDocument();
  });
});

describe("CurrentProjectSwitcher — sheet rows", () => {
  function openSheet(source: SaCurrentProjectSource = "primary", current = P1) {
    renderSwitcher({ projectId: current, source });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(current === P1 ? "Alpha" : "Beta") }),
    );
    return within(screen.getByRole("dialog"));
  }

  it("lists all visible projects", () => {
    const sheet = openSheet();
    expect(sheet.getByText(/Alpha/)).toBeInTheDocument();
    expect(sheet.getByText(/Beta/)).toBeInTheDocument();
    expect(sheet.getByText(/Gamma/)).toBeInTheDocument();
  });

  it("shows a pin control on a membership row, and marks the current primary", () => {
    const sheet = openSheet();
    expect(sheet.getByRole("button", { name: /ตั้งเป็นไซต์หลัก.*Beta/ })).toBeInTheDocument();
    // Alpha is already primary → shown as ไซต์หลัก, not offered a redundant pin.
    expect(sheet.getByText("ไซต์หลัก")).toBeInTheDocument();
    expect(sheet.queryByRole("button", { name: /ตั้งเป็นไซต์หลัก.*Alpha/ })).toBeNull();
  });

  it("HIDES the pin on a lead-only row (RPC would reject it 42501)", () => {
    const sheet = openSheet();
    expect(sheet.queryByRole("button", { name: /ตั้งเป็นไซต์หลัก.*Gamma/ })).toBeNull();
  });

  it("tapping a row sets the view-override for that project", () => {
    const sheet = openSheet();
    fireEvent.click(sheet.getByRole("button", { name: /PRC-B/ }));
    expect(mockSetOverride).toHaveBeenCalledWith(P2);
  });

  it("tapping ตั้งเป็นไซต์หลัก pins that project", () => {
    const sheet = openSheet();
    fireEvent.click(sheet.getByRole("button", { name: /ตั้งเป็นไซต์หลัก.*Beta/ }));
    expect(mockPin).toHaveBeenCalledWith(P2);
  });

  it("does NOT offer a clear/revert control when the source is the primary", () => {
    const sheet = openSheet("primary", P1);
    expect(sheet.queryByRole("button", { name: /กลับไซต์หลัก/ })).toBeNull();
  });

  it("offers a clear/revert control when a view-override is active", () => {
    const sheet = openSheet("override", P2);
    fireEvent.click(sheet.getByRole("button", { name: /กลับไซต์หลัก/ }));
    expect(mockClearOverride).toHaveBeenCalledTimes(1);
  });

  it("surfaces the action's Thai error and keeps the sheet open when a pin fails", async () => {
    mockPin.mockResolvedValueOnce({ ok: false, error: "ตั้งไซต์หลักไม่สำเร็จ ลองใหม่" });
    const sheet = openSheet("primary", P1);
    fireEvent.click(sheet.getByRole("button", { name: /ตั้งเป็นไซต์หลัก.*Beta/ }));
    expect(await screen.findByText("ตั้งไซต์หลักไม่สำเร็จ ลองใหม่")).toBeInTheDocument();
    // The sheet stays open so the SA can read the error and retry.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
