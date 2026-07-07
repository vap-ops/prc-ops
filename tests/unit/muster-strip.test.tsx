import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Spec 277 P0 — the SA-home muster strip: a one-line "ทีมงานวันนี้ · X/Y มาทำ"
// folded above แผนวันนี้, with a "ทั้งหมดมาทำ" that logs every still-absent worker
// in one tap through the same logLaborDays action the worklist uses.

const { logLaborDays, mockRefresh } = vi.hoisted(() => ({
  logLaborDays: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("@/lib/labor/actions", () => ({ logLaborDays }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { MusterStrip } from "@/components/features/sa/muster-strip";
import type { MusterSummary } from "@/lib/sa/muster";

const partial: MusterSummary = {
  present: 1,
  total: 4,
  pending: [
    { workPackageId: "wp1", workerIds: ["w1"] },
    { workPackageId: "wp2", workerIds: ["w3", "w4"] },
  ],
};

describe("MusterStrip", () => {
  beforeEach(() => {
    logLaborDays.mockReset().mockResolvedValue({ ok: true, failed: [] });
    mockRefresh.mockReset();
  });

  it("renders the X/Y มาทำ headline", () => {
    render(<MusterStrip summary={partial} dateIso="2026-07-06" />);
    expect(screen.getByText(/ทีมงานวันนี้/)).toBeInTheDocument();
    expect(screen.getByText(/1\/4 มาทำ/)).toBeInTheDocument();
  });

  it("logs every absent worker (grouped by WP) on ทั้งหมดมาทำ", async () => {
    render(<MusterStrip summary={partial} dateIso="2026-07-06" />);
    fireEvent.click(screen.getByRole("button", { name: "ทั้งหมดมาทำ" }));
    await waitFor(() => expect(logLaborDays).toHaveBeenCalledTimes(2));
    expect(logLaborDays).toHaveBeenCalledWith({
      workPackageId: "wp1",
      revalidate: "/sa",
      workDate: "2026-07-06",
      entries: [{ workerId: "w1", fraction: "full" }],
    });
    expect(logLaborDays).toHaveBeenCalledWith({
      workPackageId: "wp2",
      revalidate: "/sa",
      workDate: "2026-07-06",
      entries: [
        { workerId: "w3", fraction: "full" },
        { workerId: "w4", fraction: "full" },
      ],
    });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows ครบแล้ว and no button when the whole crew is present", () => {
    render(<MusterStrip summary={{ present: 3, total: 3, pending: [] }} dateIso="2026-07-06" />);
    expect(screen.getByText("ครบแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ทั้งหมดมาทำ" })).toBeNull();
  });

  it("renders nothing when no one is planned today", () => {
    const { container } = render(
      <MusterStrip summary={{ present: 0, total: 0, pending: [] }} dateIso="2026-07-06" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
