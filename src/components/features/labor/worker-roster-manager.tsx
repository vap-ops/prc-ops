"use client";

// Spec 46 P1 — /workers roster management (pm/super only; the PAGE is
// requireRole-gated and server-rendered, so day rates may render here —
// this is the one surface where money is visible, by design).
//
// Spec 266 U3 / ADR 0073: a ช่าง is a self-sufficient worker, hired directly (no
// contractor firm). The add form carries two orthogonal selectors — การจ่าย
// (pay_type) × สถานะ (employment_type) — and, for daily ช่าง, day rate + payee
// fields (phone, tax id, bank). Bank/tax are money/PII-isolated server-side (no
// authenticated grant); they reach this page only via the admin client behind
// requireRole(WORKER_ROSTER_ROLES).
//
// 'use client' justification: add/edit forms with busy states over the roster
// RPC actions; spec 139 — the active-toggle is an optimistic flip (React 19
// useOptimistic, no router.refresh round-trip).

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/ui/use-toast";
import {
  assignWorkerToProject,
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

type PayType = Database["public"]["Enums"]["pay_type"];
type EmploymentType = Database["public"]["Enums"]["employment_type"];

// Spec 266 U3 (ADR 0073): การจ่าย (pay_type) and สถานะ (employment_type) are two
// orthogonal axes on every ช่าง; these label maps drive the two add-form selectors.
const PAY_TYPE_LABEL: Record<PayType, string> = {
  monthly: "รายเดือน",
  daily: "รายวัน",
};
const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  permanent: "ประจำ",
  temporary: "ชั่วคราว",
};

export type ManagedWorker = {
  id: string;
  name: string;
  pay_type: PayType;
  contractor_id: string | null;
  day_rate: number;
  active: boolean;
  // Spec 75: optional roster note.
  note: string | null;
  // Spec 266 U3: สถานะ (ประจำ/ชั่วคราว) — every ช่าง carries one.
  employment_type: EmploymentType;
  // ADR 0062 U4a: is this worker bound to a portal LINE login (workers.user_id)?
  portalBound: boolean;
  // Spec 200: the worker's current project (one at a time), or null if unassigned.
  project_id: string | null;
};

// Spec 200: a project the assigner can put a worker on.
export type AssignableProject = { id: string; code: string; name: string };

function AddWorkerForm({ projects }: { projects: AssignableProject[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  // Spec 266 U3: two orthogonal selectors replace the old monthly/daily radio.
  const [payType, setPayType] = useState<PayType>("monthly");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("permanent");
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  // Spec 200 U2: optionally put the new worker on a project at creation.
  const [project, setProject] = useState("");
  const [phone, setPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Daily ช่าง are paid in-app (day_rate × days) and carry a payee; monthly ช่าง
  // are paid off-app, so the rate + bank/tax fields only apply when รายวัน.
  const isDaily = payType === "daily";

  function resetPayee() {
    setEmploymentType("permanent");
    setPhone("");
    setTaxId("");
    setBankName("");
    setBankAccountNumber("");
    setBankAccountName("");
  }

  async function submit() {
    const parsedRate = Number(rate);
    // Monthly ช่าง have no in-app rate → 0; daily parses (invalid → -1, which the
    // action rejects with the generic error).
    const dayRate = isDaily ? (Number.isFinite(parsedRate) ? parsedRate : -1) : 0;
    setBusy(true);
    setError(null);
    const result = await createWorker({
      name,
      // Seam: การจ่าย maps to createWorker's monthly/daily vocabulary (→ pay_type at
      // the RPC boundary); สถานะ passes straight through as employment_type.
      workerType: isDaily ? "dc" : "own",
      employmentType,
      dayRate,
      note,
      ...(project ? { projectId: project } : {}),
      ...(isDaily ? { phone, taxId, bankName, bankAccountNumber, bankAccountName } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setRate("");
    setNote("");
    setProject("");
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
      {/* Spec 266 U3: การจ่าย (pay_type) — how the ช่าง is paid. */}
      <div className="mt-2">
        <p className="text-ink-secondary text-sm">การจ่าย</p>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="การจ่าย">
          {(["monthly", "daily"] as const).map((value) => (
            <RadioChip
              key={value}
              name="pay-type"
              label={PAY_TYPE_LABEL[value]}
              checked={payType === value}
              onSelect={() => setPayType(value)}
            />
          ))}
        </div>
      </div>
      {/* Spec 266 U3: สถานะ (employment_type) — tenure; orthogonal to การจ่าย, so
          shown for every ช่าง (a monthly ช่าง can be temporary too). */}
      <div className="mt-2">
        <p className="text-ink-secondary text-sm">สถานะ</p>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="สถานะ">
          {(["permanent", "temporary"] as const).map((value) => (
            <RadioChip
              key={value}
              name="employment-type"
              label={EMPLOYMENT_TYPE_LABEL[value]}
              checked={employmentType === value}
              onSelect={() => setEmploymentType(value)}
            />
          ))}
        </div>
      </div>
      {/* Daily ช่าง only: day rate + payee (bank/tax live on the person; both are
          money/PII-isolated server-side, reaching this gated page via the admin
          client). Monthly ช่าง are paid off-app, so neither applies. */}
      {isDaily ? (
        <>
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
      {/* Spec 200 U2: scope the new worker to a project on day one (optional). */}
      <label className="text-ink-secondary mt-2 block text-sm">
        โครงการ
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className={FIELD_STACKED}
        >
          <option value="">ไม่ระบุ</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} {p.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="text-danger mt-2 text-sm">{error}</p> : null}
      <button
        type="button"
        disabled={busy || name.trim().length === 0 || (isDaily && rate.trim().length === 0)}
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
  projects,
}: {
  worker: ManagedWorker;
  contractorName: string | null;
  projects: AssignableProject[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(worker.name);
  const [rate, setRate] = useState(String(worker.day_rate));
  const [note, setNote] = useState(worker.note ?? "");
  // Spec 200: the project assignment (one at a time); "" = unassigned.
  const [project, setProject] = useState(worker.project_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentProject = projects.find((p) => p.id === worker.project_id) ?? null;
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
    // Spec 200: move the worker's project if it changed ("" = unassign).
    const projectChanged = project !== (worker.project_id ?? "");
    const projectResult: WorkerActionResult = projectChanged
      ? await assignWorkerToProject({ workerId: worker.id, projectId: project })
      : { ok: true };
    setBusy(false);
    const failed = [nameResult, rateResult, projectResult].find((r) => !r.ok);
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
            {/* Spec 266 U3: สถานะ badge (ประจำ/ชั่วคราว) for daily-paid ช่าง (a
                monthly ช่าง's tenure isn't roster-relevant here). */}
            {worker.pay_type === "daily" ? (
              <span className="text-ink-muted ml-1.5 text-xs">
                · {EMPLOYMENT_TYPE_LABEL[worker.employment_type]}
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
          {/* Spec 200: the worker's current project (one at a time). */}
          <p className="text-ink-secondary text-xs">
            {currentProject ? (
              <>
                โครงการ: {currentProject.code} {currentProject.name}
              </>
            ) : (
              <span className="text-ink-muted">ยังไม่ระบุโครงการ</span>
            )}
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
          {/* Spec 200: assign the worker to a project (one at a time). */}
          <label className="text-ink-secondary mt-2 block text-sm">
            โครงการ
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className={FIELD_STACKED}
            >
              <option value="">ไม่ระบุ</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.name}
                </option>
              ))}
            </select>
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

          {/* ADR 0062 U4a: a daily ช่าง is a portal user — issue/track their LINE
              claim link here. Monthly ช่าง don't have a portal. */}
          {worker.pay_type === "daily" ? (
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
  projects = [],
}: {
  workers: ManagedWorker[];
  // Legacy contractor parents (pre-ADR-0062) still resolve a name for display; new
  // ช่าง have no contractor parent.
  contractors: { id: string; name: string; status?: string; contractor_category?: string }[];
  // Spec 200: projects the assigner can put a worker on (the assign picker).
  projects?: AssignableProject[];
}) {
  const contractorNames = new Map(contractors.map((c) => [c.id, c.name]));
  // Spec 266 U3: group the roster by การจ่าย / pay_type (no legacy own/contractor vocabulary).
  const monthlyWorkers = workers.filter((w) => w.pay_type === "monthly");
  const dailyWorkers = workers.filter((w) => w.pay_type === "daily");

  return (
    <div className="flex flex-col gap-4">
      <AddWorkerForm projects={projects} />
      {(
        [
          { label: "ช่างรายเดือน", list: monthlyWorkers },
          { label: "ช่างรายวัน", list: dailyWorkers },
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
                  projects={projects}
                />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
