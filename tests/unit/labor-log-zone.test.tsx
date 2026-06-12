// Spec 46 P1 — LaborLogZone: the WP-page daily presence capture.
// Presence-only by construction: the component types carry no rate
// fields. Actions are mocked; the zone's contract is selection →
// action args, plus the list/correction affordances.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LaborLogZone, type LaborDisplayRow } from "@/components/features/labor-log-zone";
import { logLaborDays, correctLaborLog } from "@/lib/labor/actions";

vi.mock("@/lib/labor/actions", () => ({
  logLaborDays: vi.fn(),
  correctLaborLog: vi.fn(),
}));

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

import { refreshMock } from "../helpers/router-refresh";

const ROSTER = {
  own: [
    { id: "w1", name: "ช่างหนึ่ง", worker_type: "own" as const, contractor_id: null, active: true },
  ],
  dc: [
    {
      contractorId: "c1",
      contractorName: "DC Crew A",
      workers: [
        {
          id: "w2",
          name: "ดีซีสอง",
          worker_type: "dc" as const,
          contractor_id: "c1",
          active: true,
        },
      ],
    },
  ],
};

const ROWS: LaborDisplayRow[] = [
  {
    id: "r1",
    workDate: "2026-06-11",
    workerName: "ช่างหนึ่ง",
    fraction: "full",
    selfLogged: false,
  },
  { id: "r2", workDate: "2026-06-11", workerName: "ดีซีสอง", fraction: "half", selfLogged: true },
];

function renderZone(overrides: Partial<Parameters<typeof LaborLogZone>[0]> = {}) {
  return render(
    <LaborLogZone
      workPackageId="wp1"
      revalidate="/sa/projects/p1/work-packages/wp1"
      roster={ROSTER}
      rows={ROWS}
      showFlags={false}
      locked={false}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  vi.mocked(logLaborDays).mockReset().mockResolvedValue({ ok: true, failed: [] });
  vi.mocked(correctLaborLog).mockReset().mockResolvedValue({ ok: true });
  refreshMock.mockReset();
});

describe("LaborLogZone", () => {
  it("renders the roster grouped: own techs and DC by contractor", () => {
    renderZone();
    expect(screen.getByText("ช่างบริษัท")).toBeInTheDocument();
    expect(screen.getByText("DC Crew A")).toBeInTheDocument();
    expect(screen.getByLabelText("ช่างหนึ่ง")).toBeInTheDocument();
    expect(screen.getByLabelText("ดีซีสอง")).toBeInTheDocument();
  });

  it("selecting a worker reveals the fraction control defaulting to full day", async () => {
    renderZone();
    await userEvent.click(screen.getByLabelText("ช่างหนึ่ง"));
    const full = screen.getByRole("button", { name: "เต็มวัน" });
    expect(full).toHaveAttribute("aria-pressed", "true");
  });

  it("submits selected workers with their fractions", async () => {
    renderZone();
    await userEvent.click(screen.getByLabelText("ช่างหนึ่ง"));
    await userEvent.click(screen.getByLabelText("ดีซีสอง"));
    // Two toggles now — the second belongs to the DC worker.
    await userEvent.click(screen.getAllByRole("button", { name: "ครึ่งวัน" })[1]!);
    await userEvent.click(screen.getByRole("button", { name: "บันทึกแรงงาน" }));

    await waitFor(() => expect(logLaborDays).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(logLaborDays).mock.calls[0]?.[0];
    expect(arg?.workPackageId).toBe("wp1");
    expect(arg?.entries).toEqual([
      { workerId: "w1", fraction: "full" },
      { workerId: "w2", fraction: "half" },
    ]);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("locked WP hides the capture form but keeps the history", () => {
    renderZone({ locked: true });
    expect(screen.queryByRole("button", { name: "บันทึกแรงงาน" })).not.toBeInTheDocument();
    expect(screen.getByText("ช่างหนึ่ง")).toBeInTheDocument();
  });

  it("shows the self-log flag only for PM/super eyes", () => {
    renderZone({ showFlags: true });
    expect(screen.getByText("ลงให้ตัวเอง")).toBeInTheDocument();
  });

  it("correction dialog requires a reason and calls the action", async () => {
    renderZone();
    await userEvent.click(screen.getAllByRole("button", { name: "แก้ไข" })[0]!);
    await userEvent.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    expect(correctLaborLog).not.toHaveBeenCalled(); // blank reason blocked client-side

    await userEvent.type(screen.getByLabelText("เหตุผล"), "ลงผิดวัน");
    await userEvent.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
    await waitFor(() => expect(correctLaborLog).toHaveBeenCalledTimes(1));
    expect(vi.mocked(correctLaborLog).mock.calls[0]?.[0]).toMatchObject({
      logId: "r1",
      reason: "ลงผิดวัน",
      tombstone: false,
    });
  });
});
