// Spec 314 U2 — behavior coverage for the level-rates PM editor grid:
// renders one row per skill level (label + rate input + basis select + derived
// gross), a firm WHT% field, and per-row / WHT saves that call the DEFINER-backed
// server actions. Money renders through the format.ts SSOT (bahtWithSymbol).
//
// Spec 362 U2 — the grid becomes a READ-first registry: a row states the level
// and its gross rate, and the editor (rate input + basis select + save) lives in
// a BottomSheet behind แก้ไข. The save tests therefore open their sheet first —
// the sheet unmounts its children when closed, so no input exists until then.

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
import {
  LABOR_RATE_INPUT_LABEL,
  LABOR_RATE_SAVE_LABEL,
  LABOR_RATE_UNSET,
  WHT_BASIS_AFTER_LABEL,
  WHT_PCT_LABEL,
} from "@/lib/i18n/labels";
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

/** Spec 362 U2 — open a level's editor sheet. */
function openLevelEditor(level: keyof typeof WORKER_LEVEL_LABEL) {
  fireEvent.click(screen.getByRole("button", { name: `แก้ไข ${WORKER_LEVEL_LABEL[level]}` }));
}

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
    openLevelEditor("senior");
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
    fireEvent.click(screen.getByRole("button", { name: `แก้ไข ${WHT_PCT_LABEL}` }));
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
    openLevelEditor("senior");
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
    openLevelEditor("senior");
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

  // ---------------------------------------------------------------- spec 362 U2
  it("opens on the rates themselves — no editor control is mounted", () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // The numbers are still right there to read.
    expect(screen.getAllByText(bahtWithSymbol(1000)).length).toBeGreaterThanOrEqual(2);
  });

  it("a level with no rate set says so instead of showing an empty field", () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    // mid + apprentice are unset.
    expect(screen.getAllByText(LABOR_RATE_UNSET)).toHaveLength(2);
  });

  it("a row states the entered rate and its WHT basis as meta", () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    // junior: 970 entered, after_wht — the basis is WHY gross differs from entered.
    expect(
      screen.getByText(new RegExp(`970[\\s\\S]*${WHT_BASIS_AFTER_LABEL}`)),
    ).toBeInTheDocument();
  });

  it("แก้ไข opens the level's editor in a sheet, and ยกเลิก closes it", () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    openLevelEditor("senior");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByLabelText(`${WORKER_LEVEL_LABEL.senior} ${LABOR_RATE_INPUT_LABEL}`),
    ).toBeInTheDocument();
    // …and only that level's editor — not all four.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("re-opening the editor discards a cancelled edit", () => {
    // The sheet unmounts but the row's state does not, so without an explicit
    // re-seed the abandoned typing is still sitting there next time — and the
    // save button would write it.
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    const seniorLabel = WORKER_LEVEL_LABEL.senior;
    const field = () => screen.getByLabelText(`${seniorLabel} ${LABOR_RATE_INPUT_LABEL}`);
    openLevelEditor("senior");
    fireEvent.change(field(), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    openLevelEditor("senior");
    expect(field()).toHaveValue("1000");
  });

  it("the WHT card names itself and states the current rate", () => {
    render(<LevelRatesForm rows={rows} whtPct={3} />);
    expect(screen.getByRole("heading", { name: WHT_PCT_LABEL })).toBeInTheDocument();
    expect(screen.getByText("3%")).toBeInTheDocument();
  });

  it("an unset WHT% says so rather than rendering a blank", () => {
    render(<LevelRatesForm rows={rows} whtPct={null} />);
    // Scoped to the WHT card — two LEVELS are unset in this fixture too.
    const card = screen.getByRole("heading", { name: WHT_PCT_LABEL }).closest("div");
    expect(card?.textContent).toContain(LABOR_RATE_UNSET);
  });
});
