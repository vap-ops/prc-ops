"use client";

// Spec 46 P1 — /workers roster management (pm/super only; the PAGE is
// requireRole-gated and server-rendered, so day rates may render here —
// this is the one surface where money is visible, by design).
//
// ADR 0062 U1: a DC is a self-sufficient WORKER, hired directly (no contractor
// firm). The add form drops the ผู้รับเหมา parent picker and instead carries the
// DC arrangement (ประจำ/ชั่วคราว) + payee fields (phone, tax id, bank). The
// bank/tax fields are money/PII-isolated server-side (no authenticated grant);
// they reach this page only via the admin client behind requireRole(pm/super).
//
// 'use client' justification: add/edit forms with busy states over the roster
// RPC actions; spec 139 — the active-toggle is an optimistic flip (React 19
// useOptimistic, no router.refresh round-trip).

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/ui/use-toast";
import {
  createWorker,
  setWorkerDayRate,
  updateWorker,
  type WorkerActionResult,
} from "@/app/workers/actions";
import type { Database } from "@/lib/db/database.types";
import { RadioChip } from "@/components/features/common/radio-chip";
import { WorkerInviteBlock } from "@/components/features/portal/worker-invite-block";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_STACKED,
} from "@/lib/ui/classes";
import { NOTES_MAX } from "@/lib/notes/validate";

type WorkerType = Database["public"]["Enums"]["worker_type"];
// ADR 0062 U1 — DC arrangement; local union keeps the client decoupled from the
// generated enum type (values match public.dc_arrangement).
type DcArrangement = "regular" | "temporary";

const DC_ARRANGEMENT_LABEL: Record<DcArrangement, string> = {
  regular: "ประจำ",
  temporary: "ชั่วคราว",
};

export type ManagedWorker = {
  id: string;
  name: string;
  worker_type: WorkerType;
  contractor_id: string | null;
  day_rate: number;
  active: boolean;
  // Spec 75: optional roster note.
  note: string | null;
  // ADR 0062 U1: ประจำ/ชั่วคราว for DC workers (null for own techs).
  dc_arrangement: DcArrangement | null;
  // ADR 0062 U4a: is this DC worker bound to a portal LINE login (workers.user_id)?
  portalBound: boolean;
};

function AddWorkerForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [workerType, setWorkerType] = useState<WorkerType>("own");
  const [arrangement, setArrangement] = useState<DcArrangement>("regular");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDc = workerType === "dc";

  function resetPayee() {
    setArrangement("regular");
    setPhone("");
    setTaxId("");
    setBankName("");
    setBankAccountNumber("");
    setBankAccountName("");
  }

  async function submit() {
    const dayRate = Number(rate);
    setBusy(true);
    setError(null);
    const result = await createWorker({
      name,
      workerType,
      dayRate: Number.isFinite(dayRate) ? dayRate : -1,
      note,
      ...(isDc ? { arrangement, phone, taxId, bankName, bankAccountNumber, bankAccountName } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setRate("");
    setNote("");
    resetPayee();
    router.refresh();
  }

  return (
    <div className={CARD}>
      <p className="text-ink text-sm font-semibold">เพิ่มทีมงาน</p>
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
      <div className="mt-2 flex gap-2" role="radiogroup" aria-label="ประเภททีมงาน">
        {(
          [
            { value: "own", label: "ช่างบริษัท" },
            { value: "dc", label: "ทีมงาน DC" },
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
      {/* ADR 0062 U1: DC arrangement — ประจำ vs ชั่วคราว (no contractor parent). */}
      {isDc ? (
        <div className="mt-2">
          <p className="text-ink-secondary text-sm">ลักษณะการจ้าง</p>
          <div className="mt-1 flex gap-2" role="radiogroup" aria-label="ลักษณะการจ้าง">
            {(["regular", "temporary"] as const).map((value) => (
              <RadioChip
                key={value}
                name="dc-arrangement"
                label={DC_ARRANGEMENT_LABEL[value]}
                checked={arrangement === value}
                onSelect={() => setArrangement(value)}
              />
            ))}
          </div>
        </div>
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
      {/* ADR 0062 U1: DC payee fields — paid directly, so the bank lives on the
          person. Optional; bank/tax are server-isolated like the rate. */}
      {isDc ? (
        <>
          <label className="text-ink-secondary mt-2 block text-sm">
            เบอร์โทร
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              maxLength={50}
              className={FIELD_STACKED}
            />
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            เลขผู้เสียภาษี
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              maxLength={50}
              className={FIELD_STACKED}
            />
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            ธนาคาร
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              maxLength={120}
              className={FIELD_STACKED}
            />
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            เลขบัญชีธนาคาร
            <input
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
              inputMode="numeric"
              maxLength={50}
              className={FIELD_STACKED}
            />
          </label>
          <label className="text-ink-secondary mt-2 block text-sm">
            ชื่อบัญชี
            <input
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              maxLength={120}
              className={FIELD_STACKED}
            />
          </label>
        </>
      ) : null}
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
        เพิ่มทีมงาน
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
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(worker.name);
  const [rate, setRate] = useState(String(worker.day_rate));
  const [note, setNote] = useState(worker.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Spec 139: optimistic active-toggle. `committedActive` is the post-mount truth
  // (seeded from the prop, advanced only by a successful flip); `optimisticActive`
  // shows the tapped value instantly while the action is in flight and auto-reverts
  // to `committedActive` if it fails — no router.refresh on the toggle path.
  const [committedActive, setCommittedActive] = useState(worker.active);
  const [optimisticActive, setOptimisticActive] = useOptimistic(
    committedActive,
    (_current, next: boolean) => next,
  );
  const [isToggling, startToggle] = useTransition();

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

  function toggleActive() {
    const next = !committedActive;
    startToggle(async () => {
      setOptimisticActive(next); // instant flip
      const result = await updateWorker({ id: worker.id, active: next });
      // Commit on success (the optimistic value falls through to it when the
      // transition ends — no refresh); on failure the optimistic value reverts to
      // committedActive and the slice-1 toast explains the rollback.
      if (result.ok) setCommittedActive(next);
      else toast.error(result.error);
    });
  }

  return (
    <li className="border-edge border-t py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-sm ${optimisticActive ? "text-ink" : "text-ink-muted"}`}>
            {worker.name}
            {/* ADR 0062 U1: arrangement badge for DC workers. */}
            {worker.dc_arrangement ? (
              <span className="text-ink-muted ml-1.5 text-xs">
                · {DC_ARRANGEMENT_LABEL[worker.dc_arrangement]}
              </span>
            ) : null}
            {contractorName ? (
              <span className="text-ink-muted ml-1.5 text-xs">· {contractorName}</span>
            ) : null}
            {!optimisticActive ? (
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
            disabled={isToggling}
            onClick={toggleActive}
            className="text-ink-secondary text-xs font-medium hover:underline"
          >
            {optimisticActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
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

          {/* ADR 0062 U4a: a DC worker is a portal user — issue/track their LINE
              claim link here. Own techs don't have a portal. */}
          {worker.worker_type === "dc" ? (
            <div className="mt-3">
              <WorkerInviteBlock workerId={worker.id} alreadyBound={worker.portalBound} />
            </div>
          ) : null}
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
  // Legacy DC parents (pre-ADR-0062) still resolve a name for display; new DC
  // workers have no contractor parent.
  contractors: { id: string; name: string; status?: string; contractor_category?: string }[];
}) {
  const contractorNames = new Map(contractors.map((c) => [c.id, c.name]));
  const own = workers.filter((w) => w.worker_type === "own");
  const dc = workers.filter((w) => w.worker_type === "dc");

  return (
    <div className="flex flex-col gap-4">
      <AddWorkerForm />
      {(
        [
          { label: "ช่างบริษัท", list: own },
          { label: "ทีมงาน DC", list: dc },
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
