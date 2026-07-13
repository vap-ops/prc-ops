// Spec 314 U2 — behavior coverage for the level-rates PM editor grid:
// renders one row per skill level (label + rate input + basis select + derived
// gross), a firm WHT% field, and per-row / WHT saves that call the DEFINER-backed
// server actions. Money renders through the format.ts SSOT (bahtWithSymbol).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SetRateInput = { level: string; rate: number | null; basis: string };
const setLevelRate = vi.fn(async (_i: SetRateInput) => ({ ok: true }) as const);
const setWhtPct = vi.fn(async (_pct: number | null) => ({ ok: true }) as const);
vi.mock("@/app/settings/labor-rates/actions", () => ({
  setLevelRate: (i: SetRateInput) => setLevelRate(i),
  setWhtPct: (pct: number | null) => setWhtPct(pct),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LevelRatesForm, type LevelRateRow } from "@/components/features/labor/level-rates-form";
import { bahtWithSymbol } from "@/lib/format";
import { LABOR_RATE_INPUT_LABEL, LABOR_RATE_SAVE_LABEL, WHT_PCT_LABEL } from "@/lib/i18n/labels";
import { WORKER_LEVEL_LABEL } from "@/lib/nova/dials";

const rows: LevelRateRow[] = [
  { level: "senior", enteredRate: 1000, basis: "before_wht", grossRate: 1000 },
  { level: "mid", enteredRate: null, basis: "before_wht", grossRate: null },
  { level: "junior", enteredRate: 970, basis: "after_wht", grossRate: 1000 },
  { level: "apprentice", enteredRate: null, basis: "after_wht", grossRate: null },
];

beforeEach(() => {
  setLevelRate.mockClear();
  setWhtPct.mockClear();
  refresh.mockClear();
});

describe("LevelRatesForm", () => {
  it("renders a row per skill level with its label", () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    for (const level of ["senior", "mid", "junior", "apprentice"] as const) {
      expect(screen.getByText(WORKER_LEVEL_LABEL[level])).toBeInTheDocument();
    }
  });

  it("renders derived gross money via format.ts", () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    // senior + junior both gross to ฿1,000.00
    expect(screen.getAllByText(bahtWithSymbol(1000)).length).toBeGreaterThanOrEqual(2);
  });

  it("saving a level row calls setLevelRate with (level, rate, basis)", async () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    const seniorLabel = WORKER_LEVEL_LABEL.senior;
    const rateInput = screen.getByLabelText(`${seniorLabel} ${LABOR_RATE_INPUT_LABEL}`);
    fireEvent.change(rateInput, { target: { value: "1200" } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `${LABOR_RATE_SAVE_LABEL} ${seniorLabel}` }),
      );
    });
    expect(setLevelRate).toHaveBeenCalledWith({ level: "senior", rate: 1200, basis: "before_wht" });
  });

  it("saving the firm WHT% calls setWhtPct with the number", async () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    const pctInput = screen.getByLabelText(WHT_PCT_LABEL);
    fireEvent.change(pctInput, { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `${LABOR_RATE_SAVE_LABEL} ${WHT_PCT_LABEL}` }),
      );
    });
    expect(setWhtPct).toHaveBeenCalledWith(5);
  });

  it("clearing a rate (blank) sends null to clear it", async () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    const seniorLabel = WORKER_LEVEL_LABEL.senior;
    fireEvent.change(screen.getByLabelText(`${seniorLabel} ${LABOR_RATE_INPUT_LABEL}`), {
      target: { value: "" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `${LABOR_RATE_SAVE_LABEL} ${seniorLabel}` }),
      );
    });
    expect(setLevelRate).toHaveBeenCalledWith({ level: "senior", rate: null, basis: "before_wht" });
  });

  it("an unparseable rate (e.g. a comma) is rejected — the action is NOT called", async () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    const seniorLabel = WORKER_LEVEL_LABEL.senior;
    fireEvent.change(screen.getByLabelText(`${seniorLabel} ${LABOR_RATE_INPUT_LABEL}`), {
      target: { value: "1,200" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `${LABOR_RATE_SAVE_LABEL} ${seniorLabel}` }),
      );
    });
    expect(setLevelRate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
