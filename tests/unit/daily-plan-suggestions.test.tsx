// Spec 281 U2 — the แนะนำแผนพรุ่งนี้ surface. Renders the engine's draft as board
// rows, EVERY row + its crew PRE-CHECKED but not forced (D4); ใช้ที่เลือก commits
// only the still-selected rows through the existing 273 RPCs (D5 — nothing writes
// until then). RED-first.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const { applyPlanSuggestions, mockRefresh } = vi.hoisted(() => ({
  applyPlanSuggestions: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/app/sa/plan/actions", () => ({ applyPlanSuggestions }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { DailyPlanSuggestions } from "@/components/features/sa/daily-plan-suggestions";
import type { DraftItem } from "@/lib/sa/recommend-board";

const DRAFT: DraftItem[] = [
  {
    workPackageId: "a",
    code: "A-1",
    name: "งานเอ",
    tier: "carry_forward",
    reason: "ต่อจากวันนี้ — ยังไม่เสร็จ",
    crew: {
      crewId: "C1",
      crewName: "ทีมเอ",
      workerIds: ["w1", "w2"],
      leadWorkerId: "w2",
      reason: "ทีมที่ทำงานนี้ล่าสุด",
    },
  },
  {
    workPackageId: "b",
    code: "B-1",
    name: "งานบี",
    tier: "priority",
    reason: "ลำดับความสำคัญ",
    crew: null,
  },
];

function renderPanel(draft: DraftItem[] = DRAFT) {
  return render(<DailyPlanSuggestions projectId="proj-1" dateIso="2026-07-09" draft={draft} />);
}

async function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /แนะนำแผนพรุ่งนี้/ }));
  await screen.findByRole("button", { name: "ใช้ที่เลือก" });
}

describe("DailyPlanSuggestions", () => {
  beforeEach(() => {
    applyPlanSuggestions.mockReset().mockResolvedValue({ ok: true, applied: 2 });
    mockRefresh.mockReset();
  });

  it("hides the draft behind a แนะนำแผนพรุ่งนี้ trigger", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /แนะนำแผนพรุ่งนี้/ })).toBeInTheDocument();
    expect(screen.queryByText(/งานเอ/)).not.toBeInTheDocument();
  });

  it("reveals every row pre-checked with its tier reason and suggested crew", async () => {
    renderPanel();
    await openPanel();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText(/ต่อจากวันนี้/)).toBeInTheDocument();
    expect(screen.getByText(/ลำดับความสำคัญ/)).toBeInTheDocument();
    // crew chip: name + its own reason
    expect(screen.getByText(/ทีมเอ/)).toBeInTheDocument();
    expect(screen.getByText(/ล่าสุด/)).toBeInTheDocument();
  });

  it("commits only the still-selected rows via the 273 RPC action", async () => {
    renderPanel();
    await openPanel();
    // uncheck row b
    fireEvent.click(screen.getByRole("checkbox", { name: /B-1/ }));
    fireEvent.click(screen.getByRole("button", { name: "ใช้ที่เลือก" }));
    await waitFor(() => expect(applyPlanSuggestions).toHaveBeenCalledTimes(1));
    expect(applyPlanSuggestions).toHaveBeenCalledWith("proj-1", "2026-07-09", [
      { wp: "a", crew: { workerIds: ["w1", "w2"], lead: "w2" } },
    ]);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("sends crew:null for a row whose suggested crew the SA cleared", async () => {
    renderPanel();
    await openPanel();
    const rowA = screen.getByTestId("suggestion-a");
    fireEvent.click(within(rowA).getByRole("button", { name: /ล้างทีม/ }));
    fireEvent.click(screen.getByRole("button", { name: "ใช้ที่เลือก" }));
    await waitFor(() => expect(applyPlanSuggestions).toHaveBeenCalledTimes(1));
    expect(applyPlanSuggestions).toHaveBeenCalledWith("proj-1", "2026-07-09", [
      { wp: "a", crew: null },
      { wp: "b", crew: null },
    ]);
  });

  it("does not commit when nothing stays selected", async () => {
    renderPanel();
    await openPanel();
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "ใช้ที่เลือก" }));
    // give any async a tick
    await Promise.resolve();
    expect(applyPlanSuggestions).not.toHaveBeenCalled();
  });

  it("renders nothing actionable when the draft is empty", () => {
    renderPanel([]);
    expect(screen.queryByRole("button", { name: /แนะนำแผนพรุ่งนี้/ })).toBeDisabled();
  });
});
