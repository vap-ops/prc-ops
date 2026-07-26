"use client";

// Spec 314 U2 / ADR 0082 — the PM editor grid for the firm-wide standard day-rate
// per skill level + the firm WHT %. 'use client': controlled inputs with per-row
// save + useTransition pending state (a server component can't hold input state).
//
// Spec 362 U2 — READ-first, the /catalog registry shape. Every one of the four
// level rows used to render a permanently open input + basis select + save
// button, so a screen whose job is to STATE the firm's standard day rates read as
// a wall of form controls; the WHT card sat on top with no heading saying what
// its lone number was. Now a row states the level and its gross rate, with the
// entered rate + basis as meta, and the editor opens in a sheet behind แก้ไข.
// There is no search and no filter here on purpose: the rows are fixed by the
// WORKER_LEVEL_ORDER enum, so the set can never grow past a screen.
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
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  FIELD_INPUT,
  FIELD_SELECT,
  INLINE_ERROR,
} from "@/lib/ui/classes";

/** The row's editor door. One string, used by both the button and its sheet. */
const EDIT_LABEL = "แก้ไข";
const CANCEL_LABEL = "ยกเลิก";

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
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      router.refresh();
    });
  }

  // Re-seed the editor from the row whenever it opens, so a cancelled edit (or a
  // refreshed row) never leaves last time's typing in the field.
  function openEditor() {
    setRate(row.enteredRate === null ? "" : String(row.enteredRate));
    setBasis(row.basis);
    setError(null);
    setOpen(true);
  }

  const basisLabel = row.basis === "before_wht" ? WHT_BASIS_BEFORE_LABEL : WHT_BASIS_AFTER_LABEL;

  return (
    <li className="border-edge bg-card rounded-control flex flex-wrap items-center gap-3 border px-4 py-3">
      <span className="min-w-40 flex-1">
        <span className="text-ink text-body block font-semibold">{levelLabel}</span>
        <span className="text-ink-secondary text-meta block">
          {LABOR_RATE_GROSS_LABEL}:{" "}
          <span className="text-ink font-semibold">
            {row.grossRate === null ? LABOR_RATE_UNSET : bahtWithSymbol(row.grossRate)}
          </span>
        </span>
        {/* The entered rate + basis explain WHY gross differs from what was typed
            — meta, not a control, until someone asks to change it. An unset rate
            gets no meta line: the gross line above already says ยังไม่กำหนด, and
            saying it twice on one row reads like two separate blanks. */}
        {row.enteredRate === null ? null : (
          <span className="text-ink-muted text-meta block">
            {`${LABOR_RATE_INPUT_LABEL} ${row.enteredRate.toLocaleString("th-TH")} · ${basisLabel}`}
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={`${EDIT_LABEL} ${levelLabel}`}
          onClick={openEditor}
          className={BUTTON_SECONDARY_COMPACT}
        >
          {EDIT_LABEL}
        </button>
      </span>

      <BottomSheet open={open} title={`${EDIT_LABEL}${levelLabel}`} onClose={() => setOpen(false)}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-ink-secondary text-meta flex flex-1 flex-col gap-1">
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
          <label className="text-ink-secondary text-meta flex flex-col gap-1">
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
          <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY_COMPACT}>
            {CANCEL_LABEL}
          </button>
        </div>
        {error && (
          <p role="alert" className={`${INLINE_ERROR} mt-2`}>
            {error}
          </p>
        )}
      </BottomSheet>
    </li>
  );
}

function WhtRow({ whtPct }: { whtPct: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      router.refresh();
    });
  }

  function openEditor() {
    setPct(whtPct === null ? "" : String(whtPct));
    setError(null);
    setOpen(true);
  }

  // Spec 362 U2 — the card floated here with no heading: a lone number and an
  // input, on a page about day rates. It now says what it is and what it is set
  // to, and the field opens behind แก้ไข like every other write on this screen.
  return (
    <div className="border-edge bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <span className="min-w-40 flex-1">
        <h2 className="text-ink text-body font-semibold">{WHT_PCT_LABEL}</h2>
        <span className="text-ink-secondary text-meta block">
          {whtPct === null ? LABOR_RATE_UNSET : `${whtPct}%`}
        </span>
      </span>
      <button
        type="button"
        aria-label={`${EDIT_LABEL} ${WHT_PCT_LABEL}`}
        onClick={openEditor}
        className={`ml-auto shrink-0 ${BUTTON_SECONDARY_COMPACT}`}
      >
        {EDIT_LABEL}
      </button>

      {/* Title carries แก้ไข so it never collides with the field's own label:
          the sheet's h2 labels the dialog, and an identical string would make
          `getByLabelText(WHT_PCT_LABEL)` ambiguous for users and tests alike. */}
      <BottomSheet
        open={open}
        title={`${EDIT_LABEL}${WHT_PCT_LABEL}`}
        onClose={() => setOpen(false)}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-ink-secondary text-meta flex flex-1 flex-col gap-1">
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
          <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY_COMPACT}>
            {CANCEL_LABEL}
          </button>
        </div>
        {error && (
          <p role="alert" className={`${INLINE_ERROR} mt-2`}>
            {error}
          </p>
        )}
      </BottomSheet>
    </div>
  );
}

export function LevelRatesForm({ rows, whtPct }: { rows: LevelRateRow[]; whtPct: number | null }) {
  return (
    <div className="flex flex-col gap-4">
      <WhtRow whtPct={whtPct} />
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <LevelRow key={row.level} row={row} />
        ))}
      </ul>
    </div>
  );
}
