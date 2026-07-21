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
  assignProjectHt,
  assignWorkerToProject,
  createWorker,
  setWorkerDayRate,
  setWorkerLevel,
  setWorkerTrades,
  updateWorker,
  type WorkerActionResult,
} from "@/app/workers/actions";
import type { Database } from "@/lib/db/database.types";
import { WORKER_LEVEL_LABEL, WORKER_LEVEL_ORDER, type WorkerLevel } from "@/lib/nova/dials";
import { CategoryChip } from "@/components/features/work-packages/category-chip";
import {
  sortTradesPrimaryFirst,
  tradeSelectionChanged,
  type WorkerTrade,
} from "@/lib/workers/trades";
import {
  TRADE_LABEL,
  TRADE_PRIMARY_CLEAR_LABEL,
  TRADE_PRIMARY_LABEL,
  TRADES_EMPTY_LABEL,
} from "@/lib/i18n/labels";
import { BankSelect } from "@/components/features/common/bank-select";
import { RadioChip } from "@/components/features/common/radio-chip";
import { WorkerInviteBlock } from "@/components/features/portal/worker-invite-block";
import {
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  CARD,
  FIELD_STACKED,
} from "@/lib/ui/classes";
import { NOTES_MAX } from "@/lib/notes/validate";
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from "@/lib/workers/employment";

type PayType = Database["public"]["Enums"]["pay_type"];

// Spec 266 U3 (ADR 0073): การจ่าย (pay_type) and สถานะ (employment_type) are two
// orthogonal axes on every ช่าง; these label maps drive the two add-form selectors.
// EMPLOYMENT_TYPE_LABEL is single-sourced in @/lib/workers/employment (also used by
// the SA team view).
const PAY_TYPE_LABEL: Record<PayType, string> = {
  monthly: "รายเดือน",
  daily: "รายวัน",
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
  // Spec 272 U1 / ADR 0060: skill grade (null = ยังไม่ประเมิน; super_admin sets).
  level: WorkerLevel | null;
  // Spec 332: the worker's trade tags (สายงาน) — assignment axis, W01–W09.
  trades: WorkerTrade[];
  // DC edit matrix: payee fields, editable from the row's edit sheet. Money/PII —
  // reach this gated page via the admin client. bank_* is null for a portal-bound
  // worker (the loader withholds it — a bound worker owns their bank via the portal
  // request/approval flow, not a direct back-office edit).
  phone: string | null;
  tax_id: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
};

// Spec 200: a project the assigner can put a worker on. Spec 272 U2: its current
// หัวหน้าช่าง (projects.ht_worker_id) feeds the roster badge + replace-warning.
export type AssignableProject = {
  id: string;
  code: string;
  name: string;
  ht_worker_id: string | null;
};

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
      {/* Spec 313 U2b (D4): this card lives on /workers, whose heading U2 renamed
          to รายชื่อช่างและค่าแรง — and it adds ONE person, a ช่าง, so the add
          strings use that term. The people-hub term (TEAM_HUB_LABEL) now names
          only /team. */}
      <p className="text-ink text-sm font-semibold">เพิ่มช่าง</p>
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
          <p className="text-ink-secondary mt-2 text-sm">ธนาคาร</p>
          <BankSelect value={bankName} onChange={setBankName} />
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
        เพิ่มช่าง
      </button>
    </div>
  );
}

function WorkerRow({
  worker,
  contractorName,
  firms,
  projects,
  canGrade = false,
  canAssignHt = false,
  canSetTrades = false,
  tradeOptions = [],
  htCodes,
  currentProjectHt,
}: {
  worker: ManagedWorker;
  contractorName: string | null;
  /** Spec 328 firm move — ACTIVE firms the edit sheet may assign/move to. */
  firms: { id: string; name: string }[];
  projects: AssignableProject[];
  // Spec 272: UI gates mirroring the RPC gates (set_worker_level = super_admin;
  // assign_project_ht = pm/pd/super) — the DEFINER RPCs re-check server-side.
  canGrade?: boolean;
  canAssignHt?: boolean;
  // Spec 332: PM_ROLES edit trades (mirrors set_worker_trades); the W0x options.
  canSetTrades?: boolean;
  tradeOptions?: TradeOption[];
  // Spec 272 U2: codes of the projects this worker heads (the row badge)…
  htCodes: string[];
  // …and the current หัวหน้าช่าง of the worker's own project (replace-warning).
  currentProjectHt: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(worker.name);
  const [rate, setRate] = useState(String(worker.day_rate));
  const [note, setNote] = useState(worker.note ?? "");
  // Spec 200: the project assignment (one at a time); "" = unassigned.
  const [project, setProject] = useState(worker.project_id ?? "");
  // Spec 272 U1: the grade selector value ("" = still ungraded).
  const [level, setLevel] = useState<string>(worker.level ?? "");
  // Spec 332: trade selection (category ids) + the one primary. Seeded from the
  // worker's current tags; the sheet edits both, save() diffs before calling.
  const [tradeIds, setTradeIds] = useState<string[]>(worker.trades.map((t) => t.categoryId));
  const [primaryTradeId, setPrimaryTradeId] = useState<string | null>(
    worker.trades.find((t) => t.isPrimary)?.categoryId ?? null,
  );
  // DC edit matrix: การจ่าย × สถานะ + payee fields. Bank prefills only for an
  // unbound worker (the loader withholds a bound worker's bank).
  const [payType, setPayType] = useState<PayType>(worker.pay_type);
  const [employmentType, setEmploymentType] = useState<EmploymentType>(worker.employment_type);
  // Spec 328 firm move — "" = ทีม PRC (untied). A tied worker can only move
  // firm→firm (update_worker's p_contractor coalesce cannot clear; remove = an
  // operator money-judgment, deliberately not offered here).
  const [contractorPick, setContractorPick] = useState(worker.contractor_id ?? "");
  const [phone, setPhone] = useState(worker.phone ?? "");
  const [taxId, setTaxId] = useState(worker.tax_id ?? "");
  const [bankName, setBankName] = useState(worker.bank_name ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(worker.bank_account_number ?? "");
  const [bankAccountName, setBankAccountName] = useState(worker.bank_account_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [htBusy, setHtBusy] = useState(false);
  const currentProject = projects.find((p) => p.id === worker.project_id) ?? null;
  const isHtOfCurrentProject = currentProjectHt?.id === worker.id;
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
    // Spec 330 U1 lesson: a thrown action must not leave busy=true (the save
    // button is disabled={busy} — a wedge locks the sheet). finally always resets.
    try {
      const nameChanged = name.trim() !== worker.name;
      const noteChanged = note !== (worker.note ?? "");
      // DC edit matrix: pay_type × employment_type + payee fields. Bank is only
      // editable (and only forwarded) for an unbound worker — a bound worker's bank
      // routes through the portal request/approval flow, so it is never sent here.
      const payTypeChanged = payType !== worker.pay_type;
      const employmentTypeChanged = employmentType !== worker.employment_type;
      // Spec 328: only a real firm value ever forwards ("" = untied stays as-is).
      const contractorChanged =
        contractorPick !== "" && contractorPick !== (worker.contractor_id ?? "");
      const phoneChanged = phone !== (worker.phone ?? "");
      const taxIdChanged = taxId !== (worker.tax_id ?? "");
      const bankEditable = !worker.portalBound;
      const bankNameChanged = bankEditable && bankName !== (worker.bank_name ?? "");
      const bankAccountNumberChanged =
        bankEditable && bankAccountNumber !== (worker.bank_account_number ?? "");
      const bankAccountNameChanged =
        bankEditable && bankAccountName !== (worker.bank_account_name ?? "");
      // One update call carries any changed field (the RPC coalesce-preserves
      // omitted fields; note "" clears).
      const anyUpdate =
        nameChanged ||
        noteChanged ||
        payTypeChanged ||
        employmentTypeChanged ||
        phoneChanged ||
        taxIdChanged ||
        bankNameChanged ||
        bankAccountNumberChanged ||
        bankAccountNameChanged ||
        contractorChanged;
      const nameResult: WorkerActionResult = anyUpdate
        ? await updateWorker({
            id: worker.id,
            ...(nameChanged ? { name } : {}),
            ...(noteChanged ? { note } : {}),
            ...(payTypeChanged ? { payType } : {}),
            ...(employmentTypeChanged ? { employmentType } : {}),
            ...(contractorChanged ? { contractorId: contractorPick } : {}),
            ...(phoneChanged ? { phone } : {}),
            ...(taxIdChanged ? { taxId } : {}),
            ...(bankNameChanged ? { bankName } : {}),
            ...(bankAccountNumberChanged ? { bankAccountNumber } : {}),
            ...(bankAccountNameChanged ? { bankAccountName } : {}),
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
      // Spec 272 U1: grade change rides the same save ("" placeholder never sends).
      const levelChanged = canGrade && level !== "" && level !== (worker.level ?? "");
      const levelResult: WorkerActionResult = levelChanged
        ? await setWorkerLevel({ id: worker.id, level: level as WorkerLevel })
        : { ok: true };
      // Spec 332: trades ride the same save; full-replace only when the set/primary
      // actually changed (the RPC is a delete+insert, so skip the no-op call).
      const tradesChanged =
        canSetTrades && tradeSelectionChanged(worker.trades, tradeIds, primaryTradeId);
      const tradesResult: WorkerActionResult = tradesChanged
        ? await setWorkerTrades({ id: worker.id, categoryIds: tradeIds, primaryId: primaryTradeId })
        : { ok: true };
      const failed = [nameResult, rateResult, projectResult, levelResult, tradesResult].find(
        (r) => !r.ok,
      );
      if (failed && !failed.ok) {
        setError(failed.error);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Spec 272 U2: instant action (not save-coupled) — the RPC is last-wins; a
  // success re-renders the badges via router.refresh (the sheet stays open).
  async function promoteToHt() {
    if (!worker.project_id) return;
    setHtBusy(true);
    setError(null);
    const result = await assignProjectHt({ projectId: worker.project_id, workerId: worker.id });
    setHtBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
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
            {/* Spec 272 U1: skill grade (readable category, ADR 0060 §1). */}
            {worker.level ? (
              <span className="text-ink-muted ml-1.5 text-xs">
                · ระดับ{WORKER_LEVEL_LABEL[worker.level]}
              </span>
            ) : null}
            {/* Spec 272 U2: หัวหน้าช่าง badge — this worker heads these projects. */}
            {htCodes.length > 0 ? (
              <span className="text-action ml-1.5 text-xs font-medium">
                · หัวหน้าช่าง {htCodes.join(", ")}
              </span>
            ) : null}
            {!optimisticActive ? (
              <span className="text-ink-muted ml-1.5 text-xs">(ปิดใช้งาน)</span>
            ) : null}
          </p>
          {/* Spec 332: trade tags (สายงาน), primary first — compact letter tiles. */}
          {worker.trades.length > 0 ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-1">
              {sortTradesPrimaryFirst(worker.trades).map((t) => (
                <CategoryChip key={t.categoryId} code={t.code} />
              ))}
            </span>
          ) : null}
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
          {/* DC edit matrix: การจ่าย (pay_type) × สถานะ (employment_type) — the two
              orthogonal axes (spec 266 U3), editable per row. */}
          <div className="mt-2">
            <p className="text-ink-secondary text-sm">การจ่าย</p>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="การจ่าย">
              {(["monthly", "daily"] as const).map((value) => (
                <RadioChip
                  key={value}
                  name={`edit-pay-type-${worker.id}`}
                  label={PAY_TYPE_LABEL[value]}
                  checked={payType === value}
                  onSelect={() => setPayType(value)}
                />
              ))}
            </div>
          </div>
          <div className="mt-2">
            <p className="text-ink-secondary text-sm">สถานะ</p>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="สถานะ">
              {(["permanent", "temporary"] as const).map((value) => (
                <RadioChip
                  key={value}
                  name={`edit-employment-type-${worker.id}`}
                  label={EMPLOYMENT_TYPE_LABEL[value]}
                  checked={employmentType === value}
                  onSelect={() => setEmploymentType(value)}
                />
              ))}
            </div>
          </div>
          {/* Spec 328 firm move — assign an untied ช่าง to a ทีมผู้รับเหมา
              (roster backfill; they become pay-exempt — the firm pays them) or
              move a member firm→firm. Daily-paid only (a contractor member is
              always daily per the 328 approve arm; a monthly+firm row would be
              off-model). A tied worker gets NO ทีม PRC option: converting back
              to payable is operator-gated, not a sheet edit. */}
          {payType === "daily" ? (
            <>
              <label className="text-ink-secondary mt-2 block text-sm">
                ทีมผู้รับเหมา
                <select
                  value={contractorPick}
                  onChange={(e) => setContractorPick(e.target.value)}
                  className={FIELD_STACKED}
                >
                  {worker.contractor_id === null ? <option value="">— ทีม PRC —</option> : null}
                  {/* A tied worker's current firm stays selectable even if it
                      later left the active list — the select shows the truth. */}
                  {worker.contractor_id !== null &&
                  !firms.some((f) => f.id === worker.contractor_id) ? (
                    <option value={worker.contractor_id}>{contractorName ?? "ทีมปัจจุบัน"}</option>
                  ) : null}
                  {firms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              {contractorPick !== "" && contractorPick !== (worker.contractor_id ?? "") ? (
                <p className="text-ink-muted mt-1 text-xs">
                  ช่างในทีมผู้รับเหมาไม่รับค่าแรงจาก PRC (ผู้รับเหมาเป็นผู้จ่าย) —
                  การบันทึกวันทำงานหยุดทันที ส่วนวันที่บันทึกไว้แล้วยังจ่ายตามเดิม
                  และเปลี่ยนกลับเป็นทีม PRC ไม่ได้จากหน้านี้
                </p>
              ) : null}
            </>
          ) : null}
          {/* DC edit matrix: payee fields (money/PII, admin-client behind the page
              gate). phone/tax editable for every worker; bank is bind-gated below. */}
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
          {/* Bank: editable ONLY for an unbound worker. Once the ช่าง binds a portal
              login they own their bank via the request → PM-approval flow, so a
              back-office edit here would bypass that trail — show a notice instead.
              (update_worker's direct-bank write is intentionally left unchanged.) */}
          {worker.portalBound ? (
            <div className="mt-2">
              <p className="text-ink-secondary text-sm">ธนาคาร</p>
              <p className="text-ink-muted mt-1 text-sm">รออนุมัติจากคำขอของช่าง</p>
            </div>
          ) : (
            <>
              <p className="text-ink-secondary mt-2 text-sm">ธนาคาร</p>
              <BankSelect value={bankName} onChange={setBankName} />
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
          )}
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
          {/* Spec 272 U1: the grade selector — super_admin only (ADR 0060 §5).
              A graded worker gets no placeholder: the RPC has no clear path. */}
          {canGrade ? (
            <label className="text-ink-secondary mt-2 block text-sm">
              ระดับช่าง
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className={FIELD_STACKED}
              >
                {worker.level === null ? (
                  <option value="" disabled>
                    ยังไม่ประเมิน
                  </option>
                ) : null}
                {WORKER_LEVEL_ORDER.map((l) => (
                  <option key={l} value={l}>
                    {WORKER_LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {/* Spec 332: trade tags (สายงาน) — beside the level picker. Checkbox set
              + one primary radio. Deselecting the primary clears it. */}
          {canSetTrades ? (
            <fieldset className="mt-2">
              <legend className="text-ink-secondary text-sm">{TRADE_LABEL}</legend>
              <div className="mt-1 flex flex-col gap-1.5">
                {tradeOptions.map((opt) => {
                  const selected = tradeIds.includes(opt.id);
                  return (
                    <div key={opt.id} className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selected}
                          aria-label={opt.nameTh}
                          onChange={() => {
                            setTradeIds((prev) =>
                              selected ? prev.filter((id) => id !== opt.id) : [...prev, opt.id],
                            );
                            if (selected && primaryTradeId === opt.id) setPrimaryTradeId(null);
                          }}
                        />
                        <CategoryChip code={opt.code} label={opt.nameTh} />
                      </label>
                      {selected ? (
                        <label className="text-ink-muted flex items-center gap-1 text-xs">
                          <input
                            type="radio"
                            name={`trade-primary-${worker.id}`}
                            checked={primaryTradeId === opt.id}
                            aria-label={`${TRADE_PRIMARY_LABEL}: ${opt.nameTh}`}
                            onChange={() => setPrimaryTradeId(opt.id)}
                          />
                          {TRADE_PRIMARY_LABEL}
                        </label>
                      ) : null}
                    </div>
                  );
                })}
                {tradeOptions.length === 0 ? (
                  <p className="text-ink-muted text-xs">{TRADES_EMPTY_LABEL}</p>
                ) : null}
                {/* A radio can't be un-checked by clicking, so keep-trades-but-no-
                    primary (a valid RPC target) needs its own affordance. */}
                {primaryTradeId !== null ? (
                  <button
                    type="button"
                    onClick={() => setPrimaryTradeId(null)}
                    className="text-action self-start text-xs hover:underline"
                  >
                    {TRADE_PRIMARY_CLEAR_LABEL}
                  </button>
                ) : null}
              </div>
            </fieldset>
          ) : null}
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

          {/* Spec 272 U2: หัวหน้าช่าง assignment — pm/pd/super, daily ช่าง only
              (the assign_project_ht gate). Last-wins: the caption names whom a
              tap would replace. No unassign path exists (assign a successor). */}
          {canAssignHt && worker.pay_type === "daily" ? (
            <div className="mt-3">
              {isHtOfCurrentProject ? (
                <p className="text-ink-secondary text-xs font-medium">หัวหน้าช่างของโครงการนี้</p>
              ) : !worker.project_id ? (
                <p className="text-ink-muted text-xs">กำหนดโครงการก่อนจึงตั้งหัวหน้าช่างได้</p>
              ) : currentProject && committedActive ? (
                // currentProject gates the button (not just project_id): a PM's
                // RLS-scoped projects list may omit a non-member project — no
                // dangling "— " label, no acting on an unseen project.
                <>
                  <button
                    type="button"
                    disabled={htBusy}
                    onClick={() => void promoteToHt()}
                    className={BUTTON_SECONDARY_COMPACT}
                  >
                    ตั้งเป็นหัวหน้าช่าง — {currentProject.code}
                  </button>
                  {currentProjectHt && currentProjectHt.id !== worker.id ? (
                    <p className="text-ink-muted mt-1 text-xs">จะแทนที่: {currentProjectHt.name}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

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

// Spec 332: a top-level work-category the trade picker offers.
export type TradeOption = { id: string; code: string; nameTh: string };

export function WorkerRosterManager({
  workers,
  contractors,
  projects = [],
  canGrade = false,
  canAssignHt = false,
  canSetTrades = false,
  tradeOptions = [],
}: {
  workers: ManagedWorker[];
  // Legacy contractor parents (pre-ADR-0062) still resolve a name for display; new
  // ช่าง have no contractor parent.
  contractors: { id: string; name: string; status?: string; contractor_category?: string }[];
  // Spec 200: projects the assigner can put a worker on (the assign picker).
  projects?: AssignableProject[];
  // Spec 272: page-derived UI gates (super_admin grades; PM_ROLES assign HT).
  canGrade?: boolean;
  canAssignHt?: boolean;
  // Spec 332: PM_ROLES edit trades; the W01–W09 options the sheet offers.
  canSetTrades?: boolean;
  tradeOptions?: TradeOption[];
}) {
  const contractorNames = new Map(contractors.map((c) => [c.id, c.name]));
  // Spec 328 firm move — the edit sheet's assign/move targets: ACTIVE firms only
  // (spec-89 discipline: blacklisted/probation crews never join pickers).
  const activeFirms = contractors
    .filter((c) => c.status === "active")
    .map((c) => ({ id: c.id, name: c.name }));
  // Spec 266 U3: group the roster by การจ่าย / pay_type (no legacy own/contractor vocabulary).
  const monthlyWorkers = workers.filter((w) => w.pay_type === "monthly");
  const dailyWorkers = workers.filter((w) => w.pay_type === "daily");
  // Spec 272 U2: หัวหน้าช่าง lookups off the already-loaded rows (no extra query).
  const workerNames = new Map(workers.map((w) => [w.id, w.name]));
  const htCodesByWorker = new Map<string, string[]>();
  for (const p of projects) {
    if (!p.ht_worker_id) continue;
    htCodesByWorker.set(p.ht_worker_id, [...(htCodesByWorker.get(p.ht_worker_id) ?? []), p.code]);
  }
  function currentProjectHtOf(w: ManagedWorker): { id: string; name: string } | null {
    const ht = projects.find((p) => p.id === w.project_id)?.ht_worker_id ?? null;
    return ht ? { id: ht, name: workerNames.get(ht) ?? "คนปัจจุบัน" } : null;
  }

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
                  firms={activeFirms}
                  projects={projects}
                  canGrade={canGrade}
                  canAssignHt={canAssignHt}
                  canSetTrades={canSetTrades}
                  tradeOptions={tradeOptions}
                  htCodes={htCodesByWorker.get(w.id) ?? []}
                  currentProjectHt={currentProjectHtOf(w)}
                />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
