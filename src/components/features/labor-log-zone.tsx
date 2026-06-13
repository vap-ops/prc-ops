"use client";

// Spec 46 P1 — daily labor capture zone on the WP page.
//
// 'use client' justification: multi-worker selection with per-worker
// fraction toggles, optimistic submit, and an inline correction dialog.
//
// PRESENCE-ONLY BY CONSTRUCTION: the prop types carry no rate or cost
// fields, and the underlying column grants make a rate read impossible
// for field sessions regardless of what this component asks for.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { correctLaborLog, logLaborDays } from "@/lib/labor/actions";
import { bangkokTodayIso } from "@/lib/labor/dates";
import { validateCorrection } from "@/lib/labor/validate";
import { formatThaiDate } from "@/lib/i18n/labels";
import type { GroupedRoster, RosterWorker } from "@/lib/labor/group-workers";
import type { LaborDisplayRow } from "@/lib/labor/types";
import type { Database } from "@/lib/db/database.types";
import { BUTTON_SECONDARY_COMPACT, CARD, FIELD_STACKED } from "@/lib/ui/classes";
import { NOTES_MAX } from "@/lib/notes/validate";

type DayFraction = Database["public"]["Enums"]["day_fraction"];

// Moved to @/lib/labor/types in spec 65 (server-only lib code imports
// it); re-exported so existing import sites keep working.
export type { LaborDisplayRow } from "@/lib/labor/types";

const FRACTION_LABEL: Record<DayFraction, string> = {
  full: "เต็มวัน",
  half: "ครึ่งวัน",
};

function FractionToggle({
  value,
  onChange,
}: {
  value: DayFraction;
  onChange: (f: DayFraction) => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border border-zinc-300">
      {(["full", "half"] as const).map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={value === f}
          onClick={() => onChange(f)}
          className={`px-2.5 py-1 text-xs font-medium transition-colors ${
            value === f ? "bg-slate-900 text-white" : "bg-white text-zinc-700 hover:bg-zinc-50"
          }`}
        >
          {FRACTION_LABEL[f]}
        </button>
      ))}
    </span>
  );
}

function WorkerPickRow({
  worker,
  fraction,
  onToggle,
  onFraction,
}: {
  worker: RosterWorker;
  fraction: DayFraction | null;
  onToggle: () => void;
  onFraction: (f: DayFraction) => void;
}) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-2">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-zinc-900">
        <input
          type="checkbox"
          checked={fraction !== null}
          onChange={onToggle}
          className="size-4 accent-slate-900"
        />
        <span className="truncate">{worker.name}</span>
      </label>
      {fraction !== null ? <FractionToggle value={fraction} onChange={onFraction} /> : null}
    </li>
  );
}

function CorrectionDialog({
  row,
  revalidate,
  onClose,
}: {
  row: LaborDisplayRow;
  revalidate: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [fraction, setFraction] = useState<DayFraction>(row.fraction);
  const [tombstone, setTombstone] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const validation = validateCorrection({
      reason,
      fraction: tombstone ? null : fraction,
      tombstone,
    });
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    const result = await correctLaborLog({
      logId: row.id,
      revalidate,
      reason,
      fraction: tombstone ? null : fraction,
      tombstone,
    });
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-zinc-300 bg-zinc-50 p-3">
      <p className="text-xs font-semibold text-zinc-900">
        แก้ไขบันทึกของ {row.workerName} — {formatThaiDate(row.workDate)}
      </p>
      {!tombstone ? (
        <div className="mt-2">
          <FractionToggle value={fraction} onChange={setFraction} />
        </div>
      ) : null}
      <label className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={tombstone}
          onChange={(e) => setTombstone(e.target.checked)}
          className="size-4 accent-slate-900"
        />
        ลบรายการนี้ (ลงผิดคน/ผิดงาน)
      </label>
      <label className="mt-2 block text-sm text-zinc-700">
        เหตุผล
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={300}
          className={FIELD_STACKED}
        />
      </label>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
        >
          บันทึกการแก้ไข
        </button>
        <button type="button" onClick={onClose} className={BUTTON_SECONDARY_COMPACT}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

export function LaborLogZone({
  workPackageId,
  revalidate,
  roster,
  rows,
  showFlags,
  locked,
}: {
  workPackageId: string;
  revalidate: string;
  roster: GroupedRoster;
  rows: LaborDisplayRow[];
  /** PM/super only — field screens stay flag-free. */
  showFlags: boolean;
  /** WP complete: history stays, capture goes. */
  locked: boolean;
}) {
  const router = useRouter();
  const [workDate, setWorkDate] = useState<string>(() => bangkokTodayIso());
  const [selected, setSelected] = useState<Record<string, DayFraction>>({});
  // Spec 74: optional note for the day's batch.
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ workerId: string; message: string }[]>([]);
  const [correcting, setCorrecting] = useState<string | null>(null);

  const today = bangkokTodayIso();
  const selectedIds = Object.keys(selected);
  const workerNames = new Map(
    [...roster.own, ...roster.dc.flatMap((g) => g.workers)].map((w) => [w.id, w.name]),
  );

  function toggle(workerId: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[workerId]) delete next[workerId];
      else next[workerId] = "full";
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setFailures([]);
    const result = await logLaborDays({
      workPackageId,
      revalidate,
      workDate,
      entries: selectedIds.map((workerId) => ({ workerId, fraction: selected[workerId]! })),
      note,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFailures(result.failed);
    setSelected({});
    setNote("");
    router.refresh();
  }

  const byDate = new Map<string, LaborDisplayRow[]>();
  for (const row of rows) {
    const bucket = byDate.get(row.workDate);
    if (bucket) bucket.push(row);
    else byDate.set(row.workDate, [row]);
  }
  const dates = [...byDate.keys()].sort().reverse();

  const rosterEmpty = roster.own.length === 0 && roster.dc.length === 0;

  return (
    <section className="flex flex-col gap-3">
      {!locked ? (
        <div className={CARD}>
          <label className="block text-sm text-zinc-700">
            วันที่ทำงาน
            <input
              type="date"
              value={workDate}
              max={today}
              onChange={(e) => setWorkDate(e.target.value)}
              className="mt-1 block rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            />
          </label>

          {rosterEmpty ? (
            <p className="mt-3 text-sm text-zinc-600">
              {/* Spec 67: /workers had no nav entry — PM/super get a real
                  link here instead of dead prose. */}
              ยังไม่มีรายชื่อคนงาน —{" "}
              {showFlags ? (
                <>
                  เพิ่มได้ที่หน้า{" "}
                  <Link
                    href="/workers"
                    className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  >
                    คนงาน
                  </Link>
                </>
              ) : (
                "ให้ผู้จัดการโครงการเพิ่มที่หน้า คนงาน"
              )}
            </p>
          ) : (
            <>
              {roster.own.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold tracking-wide text-zinc-500">ช่างบริษัท</p>
                  <ul className="mt-1 flex flex-col">
                    {roster.own.map((w) => (
                      <WorkerPickRow
                        key={w.id}
                        worker={w}
                        fraction={selected[w.id] ?? null}
                        onToggle={() => toggle(w.id)}
                        onFraction={(f) => setSelected((prev) => ({ ...prev, [w.id]: f }))}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}
              {roster.dc.map((group) => (
                <div key={group.contractorId ?? group.contractorName} className="mt-3">
                  <p className="text-xs font-semibold tracking-wide text-zinc-500">
                    {group.contractorName}
                  </p>
                  <ul className="mt-1 flex flex-col">
                    {group.workers.map((w) => (
                      <WorkerPickRow
                        key={w.id}
                        worker={w}
                        fraction={selected[w.id] ?? null}
                        onToggle={() => toggle(w.id)}
                        onFraction={(f) => setSelected((prev) => ({ ...prev, [w.id]: f }))}
                      />
                    ))}
                  </ul>
                </div>
              ))}

              {/* Spec 74: optional day note, applied to the whole batch. */}
              <label className="mt-3 block text-sm text-zinc-700">
                หมายเหตุ
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={NOTES_MAX}
                  placeholder="เช่น ทำงานล่วงเวลา หรือสิ่งที่ทีมทำวันนี้ (ไม่บังคับ)"
                  className={FIELD_STACKED}
                />
              </label>

              {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
              {failures.length > 0 ? (
                <ul className="mt-2 text-sm text-amber-800">
                  {failures.map((f) => (
                    <li key={f.workerId}>
                      {workerNames.get(f.workerId) ?? f.workerId}: {f.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                disabled={busy || selectedIds.length === 0}
                onClick={() => void submit()}
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-slate-800 active:translate-y-px disabled:opacity-50"
              >
                บันทึกแรงงาน
              </button>
            </>
          )}
        </div>
      ) : null}

      {dates.length > 0 ? (
        <div className={CARD}>
          <p className="text-sm font-semibold text-zinc-900">บันทึกล่าสุด</p>
          <ul className="mt-2 flex flex-col gap-1">
            {dates.map((date) => (
              <li key={date} className="border-t border-zinc-200 pt-2 first:border-t-0 first:pt-0">
                <p className="text-xs font-semibold text-zinc-500">{formatThaiDate(date)}</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {(byDate.get(date) ?? []).map((row) => (
                    <li key={row.id} className="text-sm text-zinc-900">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {row.workerName}
                          <span className="mx-1.5 text-zinc-400">·</span>
                          <span className="text-zinc-700">{FRACTION_LABEL[row.fraction]}</span>
                          {showFlags && row.selfLogged ? (
                            <span className="ml-2 rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                              ลงให้ตัวเอง
                            </span>
                          ) : null}
                        </span>
                        {!locked || showFlags ? (
                          <button
                            type="button"
                            onClick={() => setCorrecting(correcting === row.id ? null : row.id)}
                            className="text-xs font-medium text-blue-700 hover:underline"
                          >
                            แก้ไข
                          </button>
                        ) : null}
                      </div>
                      {/* Spec 74: the day note (carried through corrections). */}
                      {row.note ? (
                        <p className="mt-0.5 text-xs whitespace-pre-wrap text-zinc-600">
                          หมายเหตุ: {row.note}
                        </p>
                      ) : null}
                      {correcting === row.id ? (
                        <CorrectionDialog
                          row={row}
                          revalidate={revalidate}
                          onClose={() => setCorrecting(null)}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
