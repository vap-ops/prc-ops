import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// Spec 273 U3 — the /sa morning "แผนวันนี้" worklist: today's board items with a
// one-tap มาทำ that logs the planned crew's labor via the existing logLaborDays
// action. Already-present workers show มาแล้ว (no re-tap).

const { logLaborDays, mockRefresh } = vi.hoisted(() => ({
  logLaborDays: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("@/lib/labor/actions", () => ({ logLaborDays }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { DailyPlanWorklist, type WorklistItem } from "@/components/features/sa/daily-plan-worklist";

const items: WorklistItem[] = [
  {
    id: "it1",
    workPackageId: "wp1",
    code: "WP-01-01",
    name: "ฉาบผนัง",
    projectLabel: "PRC-004",
    crew: [
      { workerId: "w1", name: "สมชาย", present: false },
      { workerId: "w2", name: "วิชัย", present: true },
    ],
  },
  {
    id: "it2",
    workPackageId: "wp2",
    code: "WP-01-02",
    name: "ทาสี",
    projectLabel: "PRC-004",
    crew: [
      { workerId: "w3", name: "มานะ", present: false },
      { workerId: "w4", name: "สมหญิง", present: false },
    ],
  },
];

function renderList(list: WorklistItem[] = items) {
  return render(<DailyPlanWorklist dateIso="2026-07-06" dateLabel="6 กรกฎาคม 2569" items={list} />);
}

const row = (id: string) => screen.getByTestId(`worklist-item-${id}`);

describe("DailyPlanWorklist", () => {
  beforeEach(() => {
    logLaborDays.mockReset().mockResolvedValue({ ok: true, failed: [] });
    mockRefresh.mockReset();
  });

  it("renders today's date and each planned งานย่อย with its crew", () => {
    renderList();
    expect(screen.getByText("6 กรกฎาคม 2569")).toBeInTheDocument();
    expect(screen.getByText(/ฉาบผนัง/)).toBeInTheDocument();
    expect(screen.getByText(/ทาสี/)).toBeInTheDocument();
    expect(within(row("it1")).getByText("สมชาย")).toBeInTheDocument();
    expect(within(row("it1")).getByText("วิชัย")).toBeInTheDocument();
  });

  it("shows มาแล้ว for an already-present worker and no มาทำ button", () => {
    renderList();
    const r = row("it1");
    expect(within(r).getByText("มาแล้ว")).toBeInTheDocument();
    expect(within(r).queryByRole("button", { name: "มาทำ วิชัย" })).toBeNull();
  });

  it("logs one worker's labor on มาทำ", async () => {
    renderList();
    fireEvent.click(within(row("it1")).getByRole("button", { name: "มาทำ สมชาย" }));
    await waitFor(() =>
      expect(logLaborDays).toHaveBeenCalledWith({
        workPackageId: "wp1",
        revalidate: "/sa",
        workDate: "2026-07-06",
        entries: [{ workerId: "w1", fraction: "full" }],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("logs the whole crew on ทั้งหมดมาทำ (only the not-yet-present)", async () => {
    renderList();
    fireEvent.click(within(row("it2")).getByRole("button", { name: "ทั้งหมดมาทำ" }));
    await waitFor(() =>
      expect(logLaborDays).toHaveBeenCalledWith({
        workPackageId: "wp2",
        revalidate: "/sa",
        workDate: "2026-07-06",
        entries: [
          { workerId: "w3", fraction: "full" },
          { workerId: "w4", fraction: "full" },
        ],
      }),
    );
  });

  it("renders nothing when there is no board for today", () => {
    renderList([]);
    expect(screen.queryByText("6 กรกฎาคม 2569")).toBeNull();
  });
});
