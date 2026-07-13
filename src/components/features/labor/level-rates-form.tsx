"use client";

// Spec 314 U2 / ADR 0082 — the PM editor grid for the firm-wide standard day-rate
// per skill level + the firm WHT %. 'use client': controlled inputs with per-row
// save + useTransition pending state (a server component can't hold input state).
// Money WRITES go through the DEFINER RPCs via the server actions; the grid only
// ever holds the seed numbers the server already read for the PM to edit. The gross
// shown per row is derived server-side in page.tsx (mirroring the DB's
// level_gross_rate, which is owner-only) from the persisted rate + basis + firm %;
// it refreshes after a save rather than re-deriving as the PM types.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setLevelRate, setWhtPct } from "@/app/settings/labor-rates/actions";
import type { WhtBasis } from "@/lib/db/enums";
import { bahtWithSymbol } from "@/lib/format";
import {
  LABOR_RATE_GROSS_LABEL,
  LABOR_RATE_INPUT_LABEL,
  LABOR_RATE_NUMBER_ERROR,
  LABOR_RATE_SAVE_LABEL,
  LABOR_RATE_UNSET,
  WHT_BASIS_AFTER_LABEL,
  WHT_BASIS_BEFORE_LABEL,
  WHT_BASIS_LABEL,
  WHT_PCT_LABEL,
} from "@/lib/i18n/labels";
import { WORKER_LEVEL_LABEL, type WorkerLevel } from "@/lib/nova/dials";
import { BUTTON_PRIMARY_COMPACT, FIELD_INPUT, FIELD_SELECT, INLINE_ERROR } from "@/lib/ui/classes";

export interface LevelRateRow {
  level: WorkerLevel;
  enteredRate: number | null;
  basis: WhtBasis;
  grossRate: number | null;
}

// Blank clears the value (→ null); a valid number is kept; anything else (a stray
// char, a thousands comma) is rejected so a mistype can't SILENTLY wipe a saved
// rate. The DEFINER RPC still range-checks the accepted number server-side.
type Parsed = { ok: true; value: number | null } | { ok: false };
function parseField(v: string): Parsed {
  const t = v.trim();
  if (t === "") return { ok: true, value: null };
  const n = Number(t);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

function LevelRow({ row }: { row: LevelRateRow }) {
  const router = useRouter();
  const levelLabel = WORKER_LEVEL_LABEL[row.level];
  const [rate, setRate] = useState(row.enteredRate === null ? "" : String(row.enteredRate));
  const [basis, setBasis] = useState<WhtBasis>(row.basis);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const parsed = parseField(rate);
    if (!parsed.ok) {
      setError(LABOR_RATE_NUMBER_ERROR);
      return;
    }
    startTransition(async () => {
      const result = await setLevelRate({ level: row.level, rate: parsed.value, basis });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="border-edge bg-card flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink text-body font-semibold">{levelLabel}</span>
        <span className="text-ink-soft text-meta">
          {LABOR_RATE_GROSS_LABEL}:{" "}
          <span className="text-ink font-semibold">
            {row.grossRate === null ? LABOR_RATE_UNSET : bahtWithSymbol(row.grossRate)}
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-ink-soft text-meta flex flex-1 flex-col gap-1">
          {LABOR_RATE_INPUT_LABEL}
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${levelLabel} ${LABOR_RATE_INPUT_LABEL}`}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            disabled={pending}
            className={FIELD_INPUT}
          />
        </label>
        <label className="text-ink-soft text-meta flex flex-col gap-1">
          {WHT_BASIS_LABEL}
          <select
            aria-label={`${levelLabel} ${WHT_BASIS_LABEL}`}
            value={basis}
            onChange={(e) => setBasis(e.target.value as WhtBasis)}
            disabled={pending}
            className={FIELD_SELECT}
          >
            <option value="before_wht">{WHT_BASIS_BEFORE_LABEL}</option>
            <option value="after_wht">{WHT_BASIS_AFTER_LABEL}</option>
          </select>
        </label>
        <button
          type="button"
          aria-label={`${LABOR_RATE_SAVE_LABEL} ${levelLabel}`}
          onClick={save}
          disabled={pending}
          className={BUTTON_PRIMARY_COMPACT}
        >
          {LABOR_RATE_SAVE_LABEL}
        </button>
      </div>
      {error && (
        <p role="alert" className={INLINE_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}

function WhtRow({ whtPct }: { whtPct: number | null }) {
  const router = useRouter();
  const [pct, setPct] = useState(whtPct === null ? "" : String(whtPct));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const parsed = parseField(pct);
    if (!parsed.ok) {
      setError(LABOR_RATE_NUMBER_ERROR);
      return;
    }
    startTransition(async () => {
      const result = await setWhtPct(parsed.value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="border-edge bg-card flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-ink-soft text-meta flex flex-1 flex-col gap-1">
          {WHT_PCT_LABEL}
          <input
            type="text"
            inputMode="decimal"
            aria-label={WHT_PCT_LABEL}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            disabled={pending}
            className={FIELD_INPUT}
          />
        </label>
        <button
          type="button"
          aria-label={`${LABOR_RATE_SAVE_LABEL} ${WHT_PCT_LABEL}`}
          onClick={save}
          disabled={pending}
          className={BUTTON_PRIMARY_COMPACT}
        >
          {LABOR_RATE_SAVE_LABEL}
        </button>
      </div>
      {error && (
        <p role="alert" className={INLINE_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}

export function LevelRatesForm({ rows, whtPct }: { rows: LevelRateRow[]; whtPct: number | null }) {
  return (
    <div className="flex flex-col gap-4">
      <WhtRow whtPct={whtPct} />
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <LevelRow key={row.level} row={row} />
        ))}
      </div>
    </div>
  );
}
