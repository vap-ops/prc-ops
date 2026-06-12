"use client";

// Spec 46 P1 — /workers roster management (pm/super only; the PAGE is
// requireRole-gated and server-rendered, so day rates may render here —
// this is the one surface where money is visible, by design).
//
// 'use client' justification: add/edit forms with optimistic busy
// states over the roster RPC actions.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createWorker,
  setWorkerDayRate,
  updateWorker,
  type WorkerActionResult,
} from "@/app/workers/actions";
import type { Database } from "@/lib/db/database.types";

type WorkerType = Database["public"]["Enums"]["worker_type"];

export type ManagedWorker = {
  id: string;
  name: string;
  worker_type: WorkerType;
  contractor_id: string | null;
  day_rate: number;
  active: boolean;
};

const FIELD_CLASSES =
  "mt-1 w-full rounded-lg border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700";
const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-slate-800 active:translate-y-px disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50";

function AddWorkerForm({ contractors }: { contractors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [workerType, setWorkerType] = useState<WorkerType>("own");
  const [contractorId, setContractorId] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const dayRate = Number(rate);
    setBusy(true);
    setError(null);
    const result = await createWorker({
      name,
      workerType,
      dayRate: Number.isFinite(dayRate) ? dayRate : -1,
      contractorId: workerType === "dc" ? contractorId || null : null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setRate("");
    setContractorId("");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-sm font-semibold text-zinc-900">เพิ่มคนงาน</p>
      <label className="mt-2 block text-sm text-zinc-700">
        ชื่อ
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className={FIELD_CLASSES}
        />
      </label>
      <div className="mt-2 flex gap-2" role="radiogroup" aria-label="ประเภทคนงาน">
        {(
          [
            { value: "own", label: "ช่างบริษัท" },
            { value: "dc", label: "คนงาน DC" },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={workerType === option.value}
            onClick={() => setWorkerType(option.value)}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              workerType === option.value
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {workerType === "dc" ? (
        <label className="mt-2 block text-sm text-zinc-700">
          ผู้รับเหมา
          <select
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            className={`${FIELD_CLASSES} appearance-none`}
          >
            <option value="">— เลือกผู้รับเหมา —</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="mt-2 block text-sm text-zinc-700">
        ค่าแรงต่อวัน (บาท)
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          className={FIELD_CLASSES}
        />
      </label>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={busy || name.trim().length === 0 || rate.trim().length === 0}
        onClick={() => void submit()}
        className={`mt-3 w-full ${PRIMARY_BUTTON}`}
      >
        เพิ่มคนงาน
      </button>
    </div>
  );
}

function WorkerRow({
  worker,
  contractorName,
}: {
  worker: ManagedWorker;
  contractorName: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(worker.name);
  const [rate, setRate] = useState(String(worker.day_rate));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const nameResult: WorkerActionResult =
      name.trim() !== worker.name ? await updateWorker({ id: worker.id, name }) : { ok: true };
    const newRate = Number(rate);
    const rateResult: WorkerActionResult =
      newRate !== worker.day_rate
        ? await setWorkerDayRate({
            id: worker.id,
            dayRate: Number.isFinite(newRate) ? newRate : -1,
          })
        : { ok: true };
    setBusy(false);
    const failed = [nameResult, rateResult].find((r) => !r.ok);
    if (failed && !failed.ok) {
      setError(failed.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  async function toggleActive() {
    setBusy(true);
    const result = await updateWorker({ id: worker.id, active: !worker.active });
    setBusy(false);
    if (result.ok) router.refresh();
  }

  return (
    <li className="border-t border-zinc-200 py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-sm ${worker.active ? "text-zinc-900" : "text-zinc-400"}`}>
            {worker.name}
            {contractorName ? (
              <span className="ml-1.5 text-xs text-zinc-500">· {contractorName}</span>
            ) : null}
            {!worker.active ? (
              <span className="ml-1.5 text-xs text-zinc-500">(ปิดใช้งาน)</span>
            ) : null}
          </p>
          <p className="text-xs text-zinc-600">{worker.day_rate.toLocaleString("th-TH")} บาท/วัน</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            แก้ไข
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleActive()}
            className="text-xs font-medium text-zinc-600 hover:underline"
          >
            {worker.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
          </button>
        </div>
      </div>
      {editing ? (
        <div className="mt-2 rounded-lg border border-zinc-300 bg-zinc-50 p-3">
          <label className="block text-sm text-zinc-700">
            ชื่อ
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className={FIELD_CLASSES}
            />
          </label>
          <label className="mt-2 block text-sm text-zinc-700">
            ค่าแรงต่อวัน (บาท)
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              className={FIELD_CLASSES}
            />
          </label>
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className={PRIMARY_BUTTON}
            >
              บันทึก
            </button>
            <button type="button" onClick={() => setEditing(false)} className={SECONDARY_BUTTON}>
              ยกเลิก
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function WorkerRosterManager({
  workers,
  contractors,
}: {
  workers: ManagedWorker[];
  contractors: { id: string; name: string }[];
}) {
  const contractorNames = new Map(contractors.map((c) => [c.id, c.name]));
  const own = workers.filter((w) => w.worker_type === "own");
  const dc = workers.filter((w) => w.worker_type === "dc");

  return (
    <div className="flex flex-col gap-4">
      <AddWorkerForm contractors={contractors} />
      {(
        [
          { label: "ช่างบริษัท", list: own },
          { label: "คนงาน DC", list: dc },
        ] as const
      ).map(({ label, list }) =>
        list.length > 0 ? (
          <div
            key={label}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-sm font-semibold text-zinc-900">{label}</p>
            <ul className="mt-2 flex flex-col">
              {list.map((w) => (
                <WorkerRow
                  key={w.id}
                  worker={w}
                  contractorName={
                    w.contractor_id ? (contractorNames.get(w.contractor_id) ?? null) : null
                  }
                />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
