"use client";

// Spec 161 U8 — the operator runs the project close-out: settle (bank the pool)
// then distribute (split it to the crew). Each row reflects the project's state —
// open / closed-unsettled / settled-undistributed / distributed — and offers only
// the action that applies. Coins are points (no baht peg); the banked profit basis
// is baht. Actions relay to the SECURITY DEFINER RPCs via the RLS server client.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { settleProjectAction, distributeProjectCoinsAction } from "@/lib/nova/settlement-actions";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";
import { CARD } from "@/lib/ui/classes";

const ACTION_BTN =
  "bg-fill text-on-fill hover:bg-fill-press inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition-colors active:translate-y-px disabled:opacity-50";

type ProjectStatus = Database["public"]["Enums"]["project_status"];

export type SettlementProject = {
  id: string;
  code: string;
  name: string;
  status: string;
  settlement: {
    coinPool: number;
    bankedProfitTotal: number;
    wpBankedCount: number;
    wpSkippedNullBudgetCount: number;
    equipmentCosted: boolean;
  } | null;
  distribution: { htCoins: number; dcDistributed: number; dcCount: number } | null;
};

const coins = (n: number) => `${n.toLocaleString("th-TH")} เหรียญ`;
const baht = (n: number) => `${n.toLocaleString("th-TH")} บาท`;

function statusLabel(status: string): string {
  return PROJECT_STATUS_LABEL[status as ProjectStatus] ?? status;
}

function Row({ p }: { p: SettlementProject }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClosed = p.status === "completed" || p.status === "archived";

  async function run(fn: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn(p.id);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <li data-testid={`proj-${p.id}`} className={CARD}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="text-ink block truncate text-sm font-semibold">
            {p.code} · {p.name}
          </span>
          <span className="text-ink-secondary block text-xs">{statusLabel(p.status)}</span>
        </span>
        {p.distribution ? (
          <span className="text-done-strong shrink-0 text-xs font-semibold">แบ่งแล้ว</span>
        ) : null}
      </div>

      {/* Settled figures (pool basis is baht; the pool is coin points). */}
      {p.settlement ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-ink-secondary">กองเหรียญ</dt>
          <dd className="text-ink text-right font-semibold tabular-nums">
            {coins(p.settlement.coinPool)}
          </dd>
          <dt className="text-ink-secondary">กำไรที่ปิดบัญชี</dt>
          <dd className="text-ink text-right tabular-nums">
            {baht(p.settlement.bankedProfitTotal)}
          </dd>
          <dt className="text-ink-secondary">WP ที่นับ · ข้าม (ไม่มีงบ)</dt>
          <dd className="text-ink text-right tabular-nums">
            {p.settlement.wpBankedCount} · {p.settlement.wpSkippedNullBudgetCount}
          </dd>
          {!p.settlement.equipmentCosted ? (
            <dd className="text-danger col-span-2 text-xs">
              * ยังไม่รวมค่าอุปกรณ์ — กองเหรียญเป็นค่าชั่วคราว
            </dd>
          ) : null}
        </dl>
      ) : null}

      {/* Distributed figures. */}
      {p.distribution ? (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-ink-secondary">ส่วนแบ่ง HT</dt>
          <dd className="text-ink text-right tabular-nums">{coins(p.distribution.htCoins)}</dd>
          <dt className="text-ink-secondary">แบ่งให้ทีม ({p.distribution.dcCount} คน)</dt>
          <dd className="text-ink text-right tabular-nums">
            {coins(p.distribution.dcDistributed)}
          </dd>
        </dl>
      ) : null}

      {/* The one action that applies. */}
      <div className="mt-3 flex items-center gap-3">
        {!isClosed ? (
          <p className="text-ink-muted text-xs">ยังไม่ปิดโครงการ — ปิดโครงการก่อนจึงสรุปได้</p>
        ) : !p.settlement ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(settleProjectAction)}
            className={ACTION_BTN}
          >
            สรุปกำไร
          </button>
        ) : !p.distribution ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(distributeProjectCoinsAction)}
            className={ACTION_BTN}
          >
            แบ่งเหรียญ
          </button>
        ) : null}
        {error ? <p className="text-danger text-sm">{error}</p> : null}
      </div>
    </li>
  );
}

export function NovaSettlementList({ projects }: { projects: SettlementProject[] }) {
  if (projects.length === 0) {
    return <p className="text-ink-secondary text-sm">ยังไม่มีโครงการ</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {projects.map((p) => (
        <Row key={p.id} p={p} />
      ))}
    </ul>
  );
}
