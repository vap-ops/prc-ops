import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// Spec 273 U2 — the /sa แผนพรุ่งนี้ board builder wires the five U1 RPCs to the UI:
// add / remove งานย่อย, set crew (+ ผู้รับผิดชอบ), set note, reorder.

const {
  addDailyPlanItem,
  removeDailyPlanItem,
  setDailyPlanItemNote,
  reorderDailyPlanItems,
  setDailyPlanItemCrew,
  mockRefresh,
  mockPush,
} = vi.hoisted(() => ({
  addDailyPlanItem: vi.fn(),
  removeDailyPlanItem: vi.fn(),
  setDailyPlanItemNote: vi.fn(),
  reorderDailyPlanItems: vi.fn(),
  setDailyPlanItemCrew: vi.fn(),
  mockRefresh: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("@/app/sa/plan/actions", () => ({
  addDailyPlanItem,
  removeDailyPlanItem,
  setDailyPlanItemNote,
  reorderDailyPlanItems,
  setDailyPlanItemCrew,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

import { DailyPlanBoard, type DailyPlanItemView } from "@/components/features/sa/daily-plan-board";
import type { WpPickerGroups } from "@/lib/work-packages/picker-options";

const projects = [{ id: "p1", code: "PRC-004", name: "โครงการ" }];
const workers = [
  { id: "w1", name: "สมชาย" },
  { id: "w2", name: "วิชัย" },
];
const leafOptions: WpPickerGroups = {
  sections: [
    { label: "WP-01 งานกลุ่ม", options: [{ id: "wp3", code: "WP-01-03", name: "ปูกระเบื้อง" }] },
  ],
  ungrouped: [],
};
const items: DailyPlanItemView[] = [
  { id: "it1", workPackageId: "wp1", code: "WP-01-01", name: "ฉาบผนัง", note: "", crew: [] },
  {
    id: "it2",
    workPackageId: "wp2",
    code: "WP-01-02",
    name: "ทาสี",
    note: "เช้า",
    crew: [{ workerId: "w1", isLead: true }],
  },
];

function renderBoard() {
  return render(
    <DailyPlanBoard
      projects={projects}
      selectedProjectId="p1"
      dateIso="2026-07-07"
      dateLabel="7 กรกฎาคม 2569"
      planId="plan1"
      leafOptions={leafOptions}
      workers={workers}
      items={items}
    />,
  );
}

function itemRow(name: string): HTMLElement {
  return screen.getByTestId(`plan-item-${name}`);
}

describe("DailyPlanBoard", () => {
  beforeEach(() => {
    addDailyPlanItem.mockReset().mockResolvedValue({ ok: true });
    removeDailyPlanItem.mockReset().mockResolvedValue({ ok: true });
    setDailyPlanItemNote.mockReset().mockResolvedValue({ ok: true });
    reorderDailyPlanItems.mockReset().mockResolvedValue({ ok: true });
    setDailyPlanItemCrew.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
    mockPush.mockReset();
  });

  it("renders the tomorrow date and each planned งานย่อย", () => {
    renderBoard();
    expect(screen.getByText("7 กรกฎาคม 2569")).toBeInTheDocument();
    expect(screen.getByText(/ฉาบผนัง/)).toBeInTheDocument();
    expect(screen.getByText(/ทาสี/)).toBeInTheDocument();
  });

  it("shows the current ผู้รับผิดชอบ on an item that has one", () => {
    renderBoard();
    // it2's lead is สมชาย (w1) — the responsible marker is on.
    const row = itemRow("it2");
    const lead = within(row).getByRole("button", { name: `ผู้รับผิดชอบ สมชาย` });
    expect(lead).toHaveAttribute("aria-pressed", "true");
  });

  it("adds the picked งานย่อย to tomorrow's board", async () => {
    renderBoard();
    fireEvent.change(screen.getByLabelText("เพิ่มงานย่อย"), { target: { value: "wp3" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่ม" }));
    await waitFor(() => expect(addDailyPlanItem).toHaveBeenCalledWith("p1", "2026-07-07", "wp3"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("removes an item", async () => {
    renderBoard();
    fireEvent.click(within(itemRow("it1")).getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(removeDailyPlanItem).toHaveBeenCalledWith("it1"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("toggles a worker into an item's crew", async () => {
    renderBoard();
    // it1 has no crew; add สมชาย.
    fireEvent.click(within(itemRow("it1")).getByRole("checkbox", { name: "สมชาย" }));
    await waitFor(() => expect(setDailyPlanItemCrew).toHaveBeenCalledWith("it1", ["w1"], null));
  });

  it("marks a crew member as ผู้รับผิดชอบ", async () => {
    renderBoard();
    // it2 crew = สมชาย(lead). Make วิชัย... first วิชัย must be in crew; toggle then star.
    const row = itemRow("it2");
    fireEvent.click(within(row).getByRole("checkbox", { name: "วิชัย" }));
    await waitFor(() =>
      expect(setDailyPlanItemCrew).toHaveBeenCalledWith("it2", ["w1", "w2"], "w1"),
    );
    setDailyPlanItemCrew.mockClear();
    fireEvent.click(within(row).getByRole("button", { name: "ผู้รับผิดชอบ วิชัย" }));
    await waitFor(() =>
      expect(setDailyPlanItemCrew).toHaveBeenCalledWith("it2", ["w1", "w2"], "w2"),
    );
  });

  it("saves a note on blur", async () => {
    renderBoard();
    const note = within(itemRow("it1")).getByLabelText("บันทึก");
    fireEvent.change(note, { target: { value: "เริ่มเช้า" } });
    fireEvent.blur(note);
    await waitFor(() => expect(setDailyPlanItemNote).toHaveBeenCalledWith("it1", "เริ่มเช้า"));
  });

  it("reorders items when moving one down", async () => {
    renderBoard();
    fireEvent.click(within(itemRow("it1")).getByRole("button", { name: "เลื่อนลง" }));
    await waitFor(() =>
      expect(reorderDailyPlanItems).toHaveBeenCalledWith("plan1", ["it2", "it1"]),
    );
  });

  it("switches project via the picker", () => {
    renderBoard();
    // With one project the picker may be hidden; render with two to test navigation.
    render(
      <DailyPlanBoard
        projects={[...projects, { id: "p2", code: "PRC-006", name: "โครงการสอง" }]}
        selectedProjectId="p1"
        dateIso="2026-07-07"
        dateLabel="7 กรกฎาคม 2569"
        planId={null}
        leafOptions={{ sections: [], ungrouped: [] }}
        workers={workers}
        items={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText("เลือกโครงการ"), { target: { value: "p2" } });
    expect(mockPush).toHaveBeenCalledWith("/sa/plan?project=p2");
  });
});
