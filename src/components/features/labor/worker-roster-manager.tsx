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
import { RadioChip } from "@/components/features/common/radio-chip";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_STACKED,
} from "@/lib/ui/classes";
import { NOTES_MAX } from "@/lib/notes/validate";

type WorkerType = Database["public"]["Enums"]["worker_type"];

export type ManagedWorker = {
  id: string;
  name: string;
  worker_type: WorkerType;
  contractor_id: string | null;
  day_rate: number;
  active: boolean;
  // Spec 75: optional roster note.
  note: string | null;
};

function AddWorkerForm({ contractors }: { contractors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [workerType, setWorkerType] = useState<WorkerType>("own");
  const [contractorId, setContractorId] = useState("");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
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
      note,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setRate("");
    setContractorId("");
    setNote("");
    router.refresh();
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เพิ่มคนงาน</p>
      <label className="text-ink-secondary mt-2 block text-sm">
        ชื่อ
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className={FIELD_STACKED}
        />
      </label>
      {/* Spec 67: native-radio chips (was a fake role="radio" on buttons). */}
      <div className="mt-2 flex gap-2" role="radiogroup" aria-label="ประเภทคนงาน">
        {(
          [
            { value: "own", label: "ช่างบริษัท" },
            { value: "dc", label: "คนงาน DC" },
          ] as const
        ).map((option) => (
          <RadioChip
            key={option.value}
            name="worker-type"
            label={option.label}
            checked={workerType === option.value}
            onSelect={() => setWorkerType(option.value)}
          />
        ))}
      </div>
      {workerType === "dc" ? (
        <label className="text-ink-secondary mt-2 block text-sm">
          ผู้รับเหมา
          <select
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            className={`${FIELD_STACKED} appearance-none`}
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
      <label className="text-ink-secondary mt-2 block text-sm">
        ค่าแรงต่อวัน (บาท)
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          className={FIELD_STACKED}
        />
      </label>
      <label className="text-ink-secondary mt-2 block text-sm">
        หมายเหตุ
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={NOTES_MAX}
          placeholder="เช่น ทักษะ เบอร์ติดต่อ (ไม่บังคับ)"
          className={FIELD_STACKED}
        />
      </label>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || name.trim().length === 0 || rate.trim().length === 0}
        onClick={() => void submit()}
        className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
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
  const [note, setNote] = useState(worker.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const nameChanged = name.trim() !== worker.name;
    const noteChanged = note !== (worker.note ?? "");
    // One update call carries any name/note change (the RPC coalesce-preserves
    // omitted fields; note "" clears).
    const nameResult: WorkerActionResult =
      nameChanged || noteChanged
        ? await updateWorker({
            id: worker.id,
            ...(nameChanged ? { name } : {}),
            ...(noteChanged ? { note } : {}),
          })
        : { ok: true };
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
    <li className="border-edge border-t py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-sm ${worker.active ? "text-ink" : "text-ink-muted"}`}>
            {worker.name}
            {contractorName ? (
              <span className="text-ink-muted ml-1.5 text-xs">· {contractorName}</span>
            ) : null}
            {!worker.active ? (
              <span className="text-ink-muted ml-1.5 text-xs">(ปิดใช้งาน)</span>
            ) : null}
          </p>
          <p className="text-ink-secondary text-xs">
            {worker.day_rate.toLocaleString("th-TH")} บาท/วัน
          </p>
          {/* Spec 75: roster note. */}
          {worker.note ? (
            <p className="text-ink-secondary mt-0.5 text-xs whitespace-pre-wrap">
              หมายเหตุ: {worker.note}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-action text-xs font-medium hover:underline"
          >
            แก้ไข
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggleActive()}
            className="text-ink-secondary text-xs font-medium hover:underline"
          >
            {worker.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
          </button>
        </div>
      </div>
      {editing ? (
        <div className="border-edge-strong bg-page mt-2 rounded-lg border p-3">
          <label className="text-ink-secondary block text-sm">
            ชื่อ
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className={FIELD_STACKED}
            />
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            ค่าแรงต่อวัน (บาท)
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              className={FIELD_STACKED}
            />
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            หมายเหตุ
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={NOTES_MAX}
              className={FIELD_STACKED}
            />
          </label>
          {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className={BUTTON_PRIMARY_COMPACT}
            >
              บันทึก
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={BUTTON_SECONDARY_COMPACT}
            >
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
  // Spec 89: status + category drive the DC-parent picker; the full list still
  // resolves names for existing rows (incl. blacklisted / non-dc parents).
  contractors: { id: string; name: string; status?: string; contractor_category?: string }[];
}) {
  const contractorNames = new Map(contractors.map((c) => [c.id, c.name]));
  const own = workers.filter((w) => w.worker_type === "own");
  const dc = workers.filter((w) => w.worker_type === "dc");
  // Spec 89: a new DC worker may only be parented by a non-blacklisted DC crew.
  const assignable = contractors.filter(
    (c) => c.contractor_category === "dc" && c.status !== "blacklisted",
  );

  return (
    <div className="flex flex-col gap-4">
      <AddWorkerForm contractors={assignable} />
      {(
        [
          { label: "ช่างบริษัท", list: own },
          { label: "คนงาน DC", list: dc },
        ] as const
      ).map(({ label, list }) =>
        list.length > 0 ? (
          <div key={label} className={CARD}>
            <p className="text-ink text-sm font-semibold">{label}</p>
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
