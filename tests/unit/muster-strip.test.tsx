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

  // Spec 306 — the money wall makes a per-worker refusal the COMMON case, not a
  // rare one: log_labor_day now rejects any worker who is contractor-tied or
  // whose cost is unconfirmed. logLaborDays reports those in `failed` while
  // still returning ok:true (one duplicate must never abort the rest of the
  // crew), so a caller that reads only `ok` treats a total refusal as a
  // success, refreshes, and shows the user nothing. That is the silent-success
  // class: the sheet behaves as though it worked and the crew stays absent.
  it("surfaces the refusal when every worker was rejected", async () => {
    logLaborDays.mockResolvedValue({
      ok: true,
      failed: [{ workerId: "w1", message: "ยังไม่ยืนยันค่าแรงของช่างคนนี้" }],
    });
    render(
      <MusterStrip
        summary={{ present: 0, total: 1, pending: [{ workPackageId: "wp1", workerIds: ["w1"] }] }}
        dateIso="2026-07-06"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ทั้งหมดมาทำ" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ยังไม่ยืนยันค่าแรงของช่างคนนี้");
    // A refresh would repaint an unchanged board and read as "it worked".
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("stays silent and refreshes when at least one worker was logged", async () => {
    logLaborDays.mockResolvedValue({
      ok: true,
      failed: [{ workerId: "w3", message: "ยังไม่ยืนยันค่าแรงของช่างคนนี้" }],
    });
    render(
      <MusterStrip
        summary={{
          present: 0,
          total: 2,
          pending: [{ workPackageId: "wp2", workerIds: ["w3", "w4"] }],
        }}
        dateIso="2026-07-06"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ทั้งหมดมาทำ" }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
