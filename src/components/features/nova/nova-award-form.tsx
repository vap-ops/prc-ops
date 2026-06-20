"use client";

// Spec 162 U1 — the operator awards Nova coins to a worker. 'use client':
// controlled multi-field form with an async submit + reset. Coins are points
// (no baht peg, ADR 0060) — the amount is a coin count, never money.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { awardCoins } from "@/lib/nova/actions";
import { COIN_SOURCES, COIN_SOURCE_LABEL, type CoinSource } from "@/lib/nova/coin-source";
import { CARD, FIELD_STACKED } from "@/lib/ui/classes";

export function NovaAwardForm({ workers }: { workers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [workerId, setWorkerId] = useState("");
  const [source, setSource] = useState<CoinSource>("behavior_bonus");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const canSubmit =
    workerId !== "" && Number.isFinite(amountNum) && amountNum > 0 && reason.trim().length > 0;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const result = await awardCoins({ workerId, source, amount: amountNum, reason: reason.trim() });
    setBusy(false);
    if (result.ok) {
      setAmount("");
      setReason("");
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">มอบเหรียญ Nova</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-ink-secondary block text-sm">
          ทีมงาน
          <select
            aria-label="ทีมงาน"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            className={FIELD_STACKED}
          >
            <option value="">เลือกทีมงาน</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-ink-secondary block text-sm">
          ประเภท
          <select
            aria-label="ประเภท"
            value={source}
            onChange={(e) => setSource(e.target.value as CoinSource)}
            className={FIELD_STACKED}
          >
            {COIN_SOURCES.map((s) => (
              <option key={s} value={s}>
                {COIN_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-ink-secondary block text-sm">
          จำนวนเหรียญ
          <input
            type="number"
            inputMode="numeric"
            min={1}
            aria-label="จำนวนเหรียญ"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD_STACKED}
          />
        </label>
        <label className="text-ink-secondary block text-sm">
          เหตุผล
          <input
            type="text"
            aria-label="เหตุผล"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น มาตรงเวลา · งานไม่มีตำหนิ"
            className={FIELD_STACKED}
          />
        </label>
      </div>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !canSubmit}
        onClick={() => void submit()}
        className="bg-fill text-on-fill hover:bg-fill-press mt-3 inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition-colors active:translate-y-px disabled:opacity-50"
      >
        มอบเหรียญ
      </button>
    </div>
  );
}
