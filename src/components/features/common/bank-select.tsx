"use client";

// Spec 317 U7 — the shared ชื่อธนาคาร picker (operator 2026-07-14: selection
// over free text, usage-frequency order, icons). Chip grid of THAI_BANKS with
// monogram color icons; order = live bank_name_usage() counts (fetched once on
// mount on the caller's own session — static market-share order until it
// resolves) with static rank as tiebreak; อื่นๆ reveals a free-text escape so
// an unlisted bank never blocks a submit. A stored non-canonical value opens in
// อื่นๆ mode prefilled, so legacy free-text rows stay editable.
// 'use client': selection state + the usage fetch.

import { useEffect, useId, useMemo, useState } from "react";
import { createClient } from "@/lib/db/browser";
import {
  findBankByName,
  sortBanksByUsage,
  THAI_BANKS,
  type ThaiBank,
} from "@/lib/banks/thai-banks";
import { FIELD_STACKED } from "@/lib/ui/classes";

function Monogram({ bank }: { bank: ThaiBank }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
      style={{ backgroundColor: bank.color }}
    >
      {bank.shortName}
    </span>
  );
}

export function BankSelect({
  value,
  onChange,
  disabled = false,
  label = "ชื่อธนาคาร",
}: {
  value: string;
  onChange: (bankName: string) => void;
  disabled?: boolean;
  /** Accessible field name for the chip group + the อื่นๆ input. */
  label?: string;
}) {
  const groupId = useId();
  // A non-empty value that is not a canonical bank = legacy/unlisted → อื่นๆ mode.
  const [otherMode, setOtherMode] = useState(() => value !== "" && !findBankByName(value));
  const [usage, setUsage] = useState<ReadonlyMap<string, number>>(new Map());

  // Controlled-value contract: a value swapped in later (async load, parent
  // reset) must land in the right mode even though the initializer ran once.
  // Render-time adjustment (the React adjust-state-on-prop-change pattern —
  // an effect would lint as set-state-in-effect). "" is ambiguous (fresh form
  // OR อื่นๆ just opened) — leave the mode alone for it.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== "") setOtherMode(!findBankByName(value));
  }

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .rpc("bank_name_usage", { p_names: THAI_BANKS.map((b) => b.name) })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setUsage(new Map(data.map((r) => [r.bank_name, Number(r.uses)])));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const banks = useMemo(() => sortBanksByUsage(usage), [usage]);

  return (
    <div>
      <div role="group" aria-label={label} id={groupId} className="mt-1.5 grid grid-cols-3 gap-1.5">
        {banks.map((b) => {
          const selected = !otherMode && value === b.name;
          return (
            <button
              key={b.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => {
                setOtherMode(false);
                onChange(b.name);
              }}
              className={
                selected
                  ? "border-action bg-action-soft rounded-control flex min-h-11 items-center gap-1.5 border px-2 py-1.5 text-left text-xs"
                  : "border-edge bg-card rounded-control flex min-h-11 items-center gap-1.5 border px-2 py-1.5 text-left text-xs"
              }
            >
              <Monogram bank={b} />
              <span className="text-ink min-w-0 leading-tight break-words">{b.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          aria-pressed={otherMode}
          onClick={() => {
            // Idempotent: a re-tap on the already-active อื่นๆ must not wipe typed text.
            if (otherMode) return;
            setOtherMode(true);
            onChange("");
          }}
          className={
            otherMode
              ? "border-action bg-action-soft rounded-control flex min-h-11 items-center gap-1.5 border px-2 py-1.5 text-left text-xs"
              : "border-edge bg-card rounded-control flex min-h-11 items-center gap-1.5 border px-2 py-1.5 text-left text-xs"
          }
        >
          <span
            aria-hidden
            className="bg-sunk text-ink-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
          >
            …
          </span>
          <span className="text-ink leading-tight">อื่นๆ</span>
        </button>
      </div>
      {otherMode ? (
        <input
          value={value}
          maxLength={120}
          disabled={disabled}
          aria-label={label}
          placeholder="พิมพ์ชื่อธนาคาร"
          onChange={(e) => onChange(e.target.value)}
          className={FIELD_STACKED}
        />
      ) : null}
    </div>
  );
}
