"use client";

// Spec 161 U7 — the operator calibrates the Nova economic dials (nova_dials) +
// per-level sell rates (sell_rate_table). Each row owns its edit state + a save
// button → the matching setter action; on success it refreshes so the persisted
// value shows. Values are economics (zero-grant) — this form is super_admin-only
// (the page gates it) and posts via the RLS server client (the setter's gate).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setNovaDial, setSellRate } from "@/lib/nova/dials-actions";
import {
  NOVA_DIALS,
  WORKER_LEVEL_LABEL,
  WORKER_LEVEL_ORDER,
  type WorkerLevel,
} from "@/lib/nova/dials";
import { CARD, FIELD_STACKED, SECTION_HEADING } from "@/lib/ui/classes";

const SAVE_BTN =
  "bg-fill text-on-fill hover:bg-fill-press inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition-colors active:translate-y-px disabled:opacity-50";

type Dial = { key: string; value: number };
type Rate = { level: WorkerLevel; cost_band: number; internal_sell: number; external_sell: number };

function DialRow({
  dialKey,
  label,
  hint,
  value,
}: {
  dialKey: string;
  label: string;
  hint: string;
  value: number;
}) {
  const router = useRouter();
  const [v, setV] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await setNovaDial(dialKey, Number(v));
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <div className="border-edge flex flex-col gap-1 border-b py-3 last:border-b-0">
      <div className="flex items-end gap-3">
        <label className="text-ink-secondary block flex-1 text-sm">
          {label}
          <input
            type="number"
            step="any"
            min={0}
            aria-label={label}
            value={v}
            onChange={(e) => setV(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          aria-label={`บันทึก ${label}`}
          className={SAVE_BTN}
        >
          บันทึก
        </button>
      </div>
      <p className="text-ink-muted text-xs">{hint}</p>
      {error ? <p className="text-danger text-sm">{error}</p> : null}
    </div>
  );
}

function RateRow({ rate }: { rate: Rate }) {
  const router = useRouter();
  const [cost, setCost] = useState(String(rate.cost_band));
  const [internal, setInternal] = useState(String(rate.internal_sell));
  const [external, setExternal] = useState(String(rate.external_sell));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const result = await setSellRate(rate.level, Number(cost), Number(internal), Number(external));
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  }

  return (
    <div
      data-testid={`rate-${rate.level}`}
      className="border-edge flex flex-col gap-2 border-b py-3 last:border-b-0"
    >
      <p className="text-ink text-sm font-semibold">ระดับ {WORKER_LEVEL_LABEL[rate.level]}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-ink-secondary block text-sm">
          ต้นทุน
          <input
            type="number"
            step="any"
            min={0}
            aria-label="ต้นทุน"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
        <label className="text-ink-secondary block text-sm">
          ราคาขายภายใน
          <input
            type="number"
            step="any"
            min={0}
            aria-label="ราคาขายภายใน"
            value={internal}
            onChange={(e) => setInternal(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
        <label className="text-ink-secondary block text-sm">
          ราคาขายภายนอก
          <input
            type="number"
            step="any"
            min={0}
            aria-label="ราคาขายภายนอก"
            value={external}
            onChange={(e) => setExternal(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void save()} className={SAVE_BTN}>
          บันทึก
        </button>
        {error ? <p className="text-danger text-sm">{error}</p> : null}
      </div>
    </div>
  );
}

export function NovaDialsForm({ dials, rates }: { dials: Dial[]; rates: Rate[] }) {
  const valueOf = (key: string) => dials.find((d) => d.key === key)?.value ?? 0;
  const orderedRates = WORKER_LEVEL_ORDER.map((lvl) => rates.find((r) => r.level === lvl)).filter(
    (r): r is Rate => r !== undefined,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className={CARD}>
        <h2 className={SECTION_HEADING}>ค่าปรับ Nova (dials)</h2>
        <p className="text-ink-secondary mt-1 text-xs">
          ทุกค่าเป็นค่าเริ่มต้นชั่วคราว — ปรับให้ตรงกับงานจริงก่อนใช้งานจริง
        </p>
        <div className="mt-2">
          {NOVA_DIALS.map((d) => (
            <DialRow
              key={d.key}
              dialKey={d.key}
              label={d.label}
              hint={d.hint}
              value={valueOf(d.key)}
            />
          ))}
        </div>
      </div>

      <div className={CARD}>
        <h2 className={SECTION_HEADING}>ราคาขายต่อระดับ (บาท)</h2>
        <p className="text-ink-secondary mt-1 text-xs">
          ต้นทุน · ราคาขายงานภายใน · ราคาขายงานภายนอก (บริษัทเก็บส่วนต่าง)
        </p>
        <div className="mt-2">
          {orderedRates.map((r) => (
            <RateRow key={r.level} rate={r} />
          ))}
        </div>
      </div>
    </div>
  );
}
