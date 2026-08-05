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
  confirmWorkerCost,
  createWorker,
  setWorkerDayRate,
  setWorkerLevel,
  setWorkerTrades,
  updateWorker,
  type WorkerActionResult,
} from "@/app/workers/actions";
import { ADD_WORKER_NETWORK_ERROR, duplicateTaxIdOwnerError } from "@/app/workers/error-copy";
import { trackFriction } from "@/lib/telemetry/friction";
import type { Database } from "@/lib/db/database.types";
import { WORKER_LEVEL_LABEL, WORKER_LEVEL_ORDER, type WorkerLevel } from "@/lib/nova/dials";
import { CategoryChip } from "@/components/features/work-packages/category-chip";
import {
  sortTradesPrimaryFirst,
  tradeSelectionChanged,
  type WorkerTrade,
} from "@/lib/workers/trades";
import { isNormalisingRename } from "@/lib/workers/thai-name";
import type { PayoutAccountState } from "@/lib/workers/payout-account";
// Spec 396 U3 reuses U2's ownership copy verbatim — the question and the fact
// must never drift apart (UI-term SSOT: a term in 2+ places lives in labels.ts).
import {
  ATTENDANCE_CALENDAR_LABEL,
  CONFIRM_COST_LABEL,
  PAY_TYPE_LABEL,
  PAYOUT_ACCOUNT_OWNER_QUESTION,
  PAYOUT_ACCOUNT_OWNER_SELF,
  PAYOUT_ACCOUNT_OWNER_SHARED_HINT,
  PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE,
  PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE_HINT,
  PAYOUT_ACCOUNT_RECORD_CTA,
  PAYOUT_ACCOUNT_REVIEW_FILTER,
  PAYOUT_ACCOUNT_REVIEW_FILTER_ALL,
  PAYOUT_ACCOUNT_SHARED_WITH_NOBODY,
  PAYOUT_ACCOUNT_SHARED_WITH_PREFIX,
  PAYOUT_ACCOUNT_SHARED_BADGE,
  PAYOUT_ACCOUNT_THIRD_PARTY_HINT,
  PAYOUT_ACCOUNT_UNRECORDED_BADGE,
  TRADE_LABEL,
  TRADE_PRIMARY_CLEAR_LABEL,
  TRADE_PRIMARY_LABEL,
  TRADES_EMPTY_LABEL,
  WORKER_BOUND_OWNER_UNKNOWN,
  workerBoundOwnerLabel,
} from "@/lib/i18n/labels";
import { Search } from "lucide-react";
import Link from "next/link";
import { BankSelect } from "@/components/features/common/bank-select";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { RadioChip } from "@/components/features/common/radio-chip";
import { WorkerInviteBlock } from "@/components/features/portal/worker-invite-block";
import {
  BUTTON_PRIMARY,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY_COMPACT,
  FIELD_INPUT,
  FIELD_STACKED,
} from "@/lib/ui/classes";

import { NOTES_MAX } from "@/lib/notes/validate";
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from "@/lib/workers/employment";

/** Spec 362 U3 — the "no การจ่าย filter" chip value (the /catalog sentinel). */
const ALL = "all";

/**
 * Spec 369 U1 — the GROSS standard day-rate per level (null = no standard set for
 * that level). Display-only: the page derives it from worker_level_rates so the
 * operator can see what confirm_worker_cost is about to stamp before pressing.
 */
export type LevelRates = Record<WorkerLevel, number | null>;

// Seeded off WORKER_LEVEL_ORDER — a plain array, NOT exhaustiveness-pinned, so a
// new worker_level enum value CAN leave a missing key behind the `as` cast. The
// read site therefore coalesces `?? null` instead of trusting the key exists.
const NO_LEVEL_RATES: LevelRates = Object.fromEntries(
  WORKER_LEVEL_ORDER.map((l) => [l, null]),
) as LevelRates;

type PayType = Database["public"]["Enums"]["pay_type"];

// Spec 266 U3 (ADR 0073): การจ่าย (pay_type) and สถานะ (employment_type) are two
// orthogonal axes on every ช่าง; these label maps drive the two add-form selectors.
// EMPLOYMENT_TYPE_LABEL is single-sourced in @/lib/workers/employment (also used by
// the SA team view); PAY_TYPE_LABEL moved to labels.ts when spec 374 gave it a
// second surface (the attendance-calendar header).

// Spec 357 U-F: เพศ — optional on both forms (null = ยังไม่ระบุ; no clear path,
// the RPC coalesce-keeps). The muster cockpit renders its ช/ญ chip off this.
type WorkerGender = Database["public"]["Enums"]["worker_gender"];
const WORKER_GENDER_LABEL: Record<WorkerGender, string> = {
  male: "ชาย",
  female: "หญิง",
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
  // Spec 396 U2: WHOSE account it is. `portalBound` alone says a binding exists
  // but not whose, which is how a real employee's record was renamed into
  // someone else's on 2026-08-04. null = bound but the display name is unknown
  // (the ownership fact still renders — the name is the detail, not the signal).
  boundUserName: string | null;
  // Spec 200: the worker's current project (one at a time), or null if unassigned.
  project_id: string | null;
  // Spec 272 U1 / ADR 0060: skill grade (null = ยังไม่ประเมิน; super_admin sets).
  level: WorkerLevel | null;
  // Spec 369 U1 / ADR 0082: when the cost (level + day_rate) was confirmed. null =
  // never — and derive_muster_labor SKIPS a worker with a null here, so an
  // unconfirmed ช่าง generates no labor_logs however many days he is mustered.
  cost_confirmed_at: string | null;
  // Spec 332: the worker's trade tags (สายงาน) — assignment axis, W01–W11.
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
  // Spec 357 U-F: เพศ (null = ยังไม่ระบุ).
  gender: WorkerGender | null;
  // Spec 395 U2: is this worker's wage landing in the worker's OWN account?
  // `unrecorded` = the account is shared with another worker and/or its holder name
  // differs, with no consented `worker_payout_nominee` row — i.e. NOT WRITTEN DOWN
  // YET, never "wrong" (a family member's account is normal here, per the operator).
  // `null` = the viewer is outside PAYOUT_NOMINEE_ROLES, so the page never computed
  // it: the gate is at the SOURCE, and the state simply does not reach this bundle.
  //
  // ⚠️ `nameMatches` is carried because it selects the REMEDY, not just the wording.
  // On a shared account the holder is often one of the workers themselves (live
  // 2026-08-05: 2 of the 3 shared groups contain their own owner). That person needs
  // no บัญชีตัวแทน — inviting them to record one would have them invent a nominee for
  // their own account. The work belongs to the OTHER rows on that account.
  // Invariant from the classifier: `unrecorded && nameMatches` implies `isShared`,
  // because a lone account whose name matches is classified `own`.
  payoutAccount: {
    state: PayoutAccountState;
    isShared: boolean;
    nameMatches: boolean;
    // Spec 395 U4: the OTHER active workers paid into this same account, by name. This
    // is the fact that decides the row — several others reads "third party, record a
    // บัญชีตัวแทน"; an empty list on a flagged row reads "the name or number is off".
    // Names only, never ids: the reviewer needs to recognise people, not join tables.
    sharedWith: readonly string[];
  } | null;
};

// Spec 200: a project the assigner can put a worker on. Spec 272 U2: its current
// หัวหน้าช่าง (projects.ht_worker_id) feeds the roster badge + replace-warning.
export type AssignableProject = {
  id: string;
  code: string;
  name: string;
  ht_worker_id: string | null;
};

function AddWorkerForm({
  projects,
  roster,
  onShowExisting,
  onDone,
}: {
  projects: AssignableProject[];
  // Field incident 2026-08-04: `workers.tax_id` is UNIQUE, so re-adding a ช่าง who is
  // already on the roster is refused by the DB (23505) — and the roster this form
  // sits above already carries every tax_id, so the collision is knowable here,
  // before the round trip, with the colliding person NAMED.
  roster: ReadonlyArray<{ id: string; name: string; tax_id: string | null }>;
  // Point at the row instead of describing it: filter the roster down to that ช่าง.
  onShowExisting: (name: string) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  // Spec 266 U3: two orthogonal selectors replace the old monthly/daily radio.
  const [payType, setPayType] = useState<PayType>("monthly");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("permanent");
  // Spec 357 U-F: optional เพศ ("" = not picked → not sent, column stays null).
  const [gender, setGender] = useState<WorkerGender | "">("");
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
  // The ช่าง the typed เลขบัตร already belongs to — held separately from `error`
  // because it earns an affordance (ดูช่างคนเดิม), not just a sentence.
  const [duplicate, setDuplicate] = useState<{ name: string } | null>(null);

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
    setError(null);
    setDuplicate(null);

    // Pre-check the one refusal the DB will make permanently. Only daily ช่าง send a
    // tax id at all (the payee block is gated on รายวัน), and the roster row's value
    // is stored btrim'd by the RPC — so a trimmed exact compare is the same key the
    // unique index uses.
    const typedTaxId = taxId.trim();
    if (isDaily && typedTaxId !== "") {
      const owner = roster.find((w) => (w.tax_id ?? "").trim() === typedTaxId);
      if (owner) {
        setDuplicate({ name: owner.name });
        setError(duplicateTaxIdOwnerError(owner.name));
        // This refusal was invisible in the field — no server log, no telemetry, and
        // a generic message the user read as "the app is broken".
        trackFriction("validation_error", { where: "workers_add", reason: "duplicate_tax_id" });
        return;
      }
    }

    setBusy(true);
    try {
      const result = await createWorker({
        name,
        // Seam: การจ่าย maps to createWorker's monthly/daily vocabulary (→ pay_type at
        // the RPC boundary); สถานะ passes straight through as employment_type.
        workerType: isDaily ? "dc" : "own",
        employmentType,
        dayRate,
        note,
        ...(gender !== "" ? { gender } : {}),
        ...(project ? { projectId: project } : {}),
        ...(isDaily ? { phone, taxId, bankName, bankAccountNumber, bankAccountName } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setRate("");
      setNote("");
      setProject("");
      setGender("");
      resetPayee();
      onDone();
      router.refresh();
    } catch (err) {
      // The button is invoked as `void submit()`, so a transport throw used to skip
      // setBusy(false) entirely and leave it disabled at กำลังบันทึก… with no message
      // — literally "I cannot press it" (the 2026-07-27 SA incident, same shape).
      // Re-report what the unhandled rejection used to give telemetry for free.
      trackFriction("js_error", {
        where: "workers_add",
        message: err instanceof Error ? err.message : String(err),
      });
      setError(ADD_WORKER_NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  // Spec 313 U2b (D4): this form lives on /workers, whose heading U2 renamed to
  // รายชื่อช่างและค่าแรง — and it adds ONE person, a ช่าง, so the add strings use
  // that term. The people-hub term (TEAM_HUB_LABEL) now names only /team.
  // Spec 362 U3: it lives inside a sheet now, so its own heading is gone — the
  // sheet's title carries it.
  return (
    <div>
      <label className="text-ink-secondary block text-sm">
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
      {/* Spec 357 U-F: เพศ — optional (skippable; the muster cockpit shows ช/ญ). */}
      <div className="mt-2">
        <p className="text-ink-secondary text-sm">เพศ</p>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="เพศ">
          {(["male", "female"] as const).map((value) => (
            <RadioChip
              key={value}
              name="gender"
              label={WORKER_GENDER_LABEL[value]}
              checked={gender === value}
              onSelect={() => setGender(value)}
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
              onChange={(e) => {
                setTaxId(e.target.value);
                // Retire the refusal WITH the number that caused it — otherwise the
                // sentence and its ดูช่างคนเดิม button keep naming a ช่าง who has
                // nothing to do with what is now in the field.
                if (duplicate) {
                  setDuplicate(null);
                  setError(null);
                }
              }}
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
      {error ? (
        <p className="text-danger mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {/* A permanent refusal must leave the user somewhere to GO: the ช่าง already
          exists, so hand over the row rather than a description of it. */}
      {duplicate ? (
        <button
          type="button"
          onClick={() => onShowExisting(duplicate.name)}
          className={`mt-2 w-full ${BUTTON_SECONDARY_COMPACT}`}
        >
          ดูช่างคนเดิม
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy || name.trim().length === 0 || (isDaily && rate.trim().length === 0)}
        onClick={() => void submit()}
        className={`mt-3 w-full ${BUTTON_PRIMARY_COMPACT}`}
      >
        เพิ่มรายชื่อ
      </button>
    </div>
  );
}

function WorkerRow({
  worker,
  contractorName,
  firms,
  projects,
  roster,
  onShowExisting,
  canGrade = false,
  canAssignHt = false,
  canSetTrades = false,
  tradeOptions = [],
  levelRates = NO_LEVEL_RATES,
  htCodes,
  currentProjectHt,
}: {
  worker: ManagedWorker;
  contractorName: string | null;
  // #945 parity: the edit sheet writes tax_id too, so it can hit
  // `workers_tax_id_unique` exactly like the add sheet. The whole roster is already
  // in this component's props, so the collision is knowable before the round trip.
  roster: ReadonlyArray<{ id: string; name: string; tax_id: string | null }>;
  onShowExisting: (name: string) => void;
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
  // Spec 369 U1: standard gross rate per level, for the cost-confirm preview.
  levelRates?: LevelRates;
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
  // Spec 357 U-F: เพศ ("" = ยังไม่ระบุ; forwarding only a real changed value —
  // the RPC coalesce-keeps, there is no clear path).
  const [gender, setGender] = useState<WorkerGender | "">(worker.gender ?? "");
  // Spec 328 firm move — "" = ทีม PRC (untied). A tied worker can only move
  // firm→firm (update_worker's p_contractor coalesce cannot clear; remove = an
  // operator money-judgment, deliberately not offered here).
  const [contractorPick, setContractorPick] = useState(worker.contractor_id ?? "");
  const [phone, setPhone] = useState(worker.phone ?? "");
  const [taxId, setTaxId] = useState(worker.tax_id ?? "");
  const [bankName, setBankName] = useState(worker.bank_name ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(worker.bank_account_number ?? "");
  const [bankAccountName, setBankAccountName] = useState(worker.bank_account_name ?? "");
  // Spec 395 U3 — transient ROUTING only, never written. §4 forbids a new column on
  // `workers`, and that is the right call: U1 re-derives the truth from the account
  // itself, so this answer cannot rot into a stale "someone said this was fine".
  //
  // ⓘ This initial value is NOT observable: `openEditor()` re-seeds it on every open,
  // including the first, so the sheet always starts at "ของช่างเอง" regardless. A
  // mutation flipping it to `true` therefore survives — an EQUIVALENT mutant, not a
  // coverage hole. The behaviour that matters is pinned on the re-seed instead.
  const [bankOwnerIsOther, setBankOwnerIsOther] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // #945 parity: the other ช่าง the typed เลขบัตร belongs to — it earns a door
  // (ดูช่างคนเดิม), not just a sentence.
  const [duplicate, setDuplicate] = useState<{ name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [htBusy, setHtBusy] = useState(false);
  // Spec 369 U1: the cost-confirm has its own in-flight flag — it is an instant
  // action beside บันทึก, so sharing `busy` would disable the save mid-confirm.
  const [confirmBusy, setConfirmBusy] = useState(false);
  const currentProject = projects.find((p) => p.id === worker.project_id) ?? null;
  const isHtOfCurrentProject = currentProjectHt?.id === worker.id;
  // Spec 139: optimistic active-toggle. `committedActive` is the post-mount truth
  // (seeded from the prop, advanced only by a successful flip); `optimisticActive`
  // shows the tapped value instantly while the action is in flight and auto-reverts
  // to `committedActive` if it fails — no router.refresh on the toggle path.
  const [committedActive, setCommittedActive] = useState(worker.active);

  // Spec 362 U3 — re-seed EVERY field from the row when the editor opens. The
  // state above survives the sheet's unmount, and the sheet added three ways to
  // abandon an edit the old inline block never had (scrim tap, Escape, ✕). Without
  // this, abandoned typing — including bank and tax id — waits for the next opener
  // and บันทึก writes it. `committedActive` is deliberately NOT re-seeded: it is
  // the optimistic toggle's post-mount truth, not editor state.
  function openEditor() {
    setName(worker.name);
    setRate(String(worker.day_rate));
    setNote(worker.note ?? "");
    setProject(worker.project_id ?? "");
    setLevel(worker.level ?? "");
    setTradeIds(worker.trades.map((t) => t.categoryId));
    setPrimaryTradeId(worker.trades.find((t) => t.isPrimary)?.categoryId ?? null);
    setPayType(worker.pay_type);
    setEmploymentType(worker.employment_type);
    setGender(worker.gender ?? "");
    setContractorPick(worker.contractor_id ?? "");
    setPhone(worker.phone ?? "");
    setTaxId(worker.tax_id ?? "");
    setBankName(worker.bank_name ?? "");
    setBankAccountNumber(worker.bank_account_number ?? "");
    setBankAccountName(worker.bank_account_name ?? "");
    // Spec 395 U3: the owner question is transient, so it re-seeds with the fields.
    // Without this an abandoned "ของคนอื่น" would still be selected next time this row
    // is opened, showing a nominee prompt nobody asked for — the same survives-the-
    // unmount hazard the re-seed above exists for.
    setBankOwnerIsOther(false);
    setError(null);
    // …and the duplicate DOOR, for the same reason the fields are re-seeded: it
    // survives the unmount, so a reopened sheet would offer ดูช่างคนเดิม for a ช่าง
    // who has nothing to do with the freshly re-seeded number.
    setDuplicate(null);
    // Spec 396 U3: same reasoning — an abandoned rename question must not
    // survive the unmount and greet the next open, where it would ask about a
    // name the freshly re-seeded field no longer holds.
    setPendingRename(null);
    setEditing(true);
  }
  const [optimisticActive, setOptimisticActive] = useOptimistic(
    committedActive,
    (_current, next: boolean) => next,
  );
  const [isToggling, startToggle] = useTransition();

  async function save({ confirmed = false }: { confirmed?: boolean } = {}) {
    setError(null);
    setDuplicate(null);

    // #945 parity — refuse a เลขบัตร that belongs to SOMEONE ELSE before spending the
    // round trip, and name them. Self is excluded: the unique index does not fire a
    // row against itself, so an untouched (or re-typed identical) own value is fine.
    // The refusal stops the WHOLE save, not just the tax id: the other edits (name,
    // rate, project, level, trades) ride the same press, and half-saving a record the
    // user is about to correct is worse than asking them to press again.
    // ⚖️ OPERATOR RULING 2026-08-04, asked and answered explicitly ("keep the whole-save
    // abort") — this is a DECISION, not an implementation accident. Before "fixing" it
    // so the siblings still apply, get a new ruling. The pin is in
    // worker-roster-manager.test.tsx: the duplicate case asserts BOTH updateWorker and
    // setWorkerDayRate go uncalled.
    const typedTaxId = taxId.trim();
    if (typedTaxId !== "") {
      // Excluding SELF is the whole rule, and it is the same rule the unique index
      // applies: a row never conflicts with itself. Comparing against the row's own
      // stored value instead would be an unreachable second guard — and it would
      // miss an own value that is stored untrimmed.
      const owner = roster.find(
        (w) => w.id !== worker.id && (w.tax_id ?? "").trim() === typedTaxId,
      );
      if (owner) {
        setDuplicate({ name: owner.name });
        setError(duplicateTaxIdOwnerError(owner.name));
        // Spec 396 U3: drop any open rename question — the save is refused, and
        // leaving it up would mount TWO role="alert" nodes (this refusal and a
        // stale question) side by side, which reads as one confused message.
        setPendingRename(null);
        trackFriction("validation_error", { where: "workers_edit", reason: "duplicate_tax_id" });
        return;
      }
    }

    // Spec 396 U3 — renaming a record that belongs to someone with their own
    // login, into a DIFFERENT person, asks once before it writes.
    //
    // ⚠️ Deliberately narrow. Of the 11 real renames of bound workers on
    // 2026-08-04, ten were a bulk honorific pass; only the eleventh replaced a
    // human. isNormalisingRename keeps those ten silent, because a question that
    // fires on routine work is dismissed by muscle memory before it ever meets
    // the one that matters. Unbound rows never ask at all — the hazard is
    // specific to a record another person owns.
    //
    // ⚠️ Consent arrives as an ARGUMENT from the prompt's own button, never as
    // shared state. An earlier draft gated on `pendingRename === typedName`, so
    // pressing บันทึก twice satisfied the confirm without anyone reading it
    // (press 1 stored the pending name, press 2 matched it) — the exact
    // muscle-memory bypass this unit exists to prevent. Only the button inside
    // the prompt can pass `confirmed`.
    //
    // A blank name is left out: update_worker nullifs an empty p_name and
    // coalesce-keeps the stored one, so blanking is a no-op, not a rename.
    const typedName = name.trim();
    if (
      !confirmed &&
      worker.portalBound &&
      typedName !== "" &&
      typedName !== worker.name &&
      !isNormalisingRename(worker.name, typedName)
    ) {
      setPendingRename(typedName);
      return;
    }
    // Past the gate: no stale question may outlive the write it belonged to.
    setPendingRename(null);

    setBusy(true);
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
      const genderChanged = gender !== "" && gender !== (worker.gender ?? "");
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
        genderChanged ||
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
            ...(genderChanged ? { gender } : {}),
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

  // Spec 369 U1: the level this confirm would write — the sheet's pick when the
  // operator has changed it, otherwise the persisted grade. Reading the PICK (not
  // worker.level) is what lets grade-and-confirm happen in one press.
  const pickedLevel: WorkerLevel | null = level !== "" ? (level as WorkerLevel) : worker.level;
  // The rate confirm_worker_cost will stamp for that level. null = the level has no
  // standard, and the RPC then COALESCES to the worker's existing day_rate — which
  // on an unrated ช่าง silently confirms ฿0, a row derive_muster_labor skips anyway
  // for `day_rate > 0`. So a missing standard blocks the confirm rather than
  // stamping a confirmation that buys nothing. A standard of 0 blocks the same way
  // (the RPC's stamp condition is `day_rate is not null`, not `> 0` — confirming 0
  // would mint the exact ยืนยันแล้ว-but-skipped state this door exists to end), and
  // `?? null` covers an enum value missing from the cast-built map.
  const rawStandard = pickedLevel === null ? null : (levelRates[pickedLevel] ?? null);
  const previewRate = rawStandard !== null && rawStandard > 0 ? rawStandard : null;
  // derive_muster_labor derives only UNTIED workers, and monthly staff are paid
  // off-app (their roster rate is forced 0 by design) — a confirm on either class
  // would stamp a meaningless daily standard. The door is daily + ทีม PRC only.
  const confirmable = worker.pay_type === "daily" && worker.contractor_id === null;

  // Spec 396 U2: stable per-row id so the ชื่อ input can aria-describedby the
  // ownership line that sits beside it.
  const ownerHintId = `owner-hint-${worker.id}`;

  // Spec 396 U3: the name this save is waiting to be confirmed for. Holds the
  // TRIMMED value rather than a bare boolean, so editing the field again after
  // the question appears re-arms it instead of letting a stale yes carry a
  // different name through.
  const [pendingRename, setPendingRename] = useState<string | null>(null);

  // Instant action, not save-coupled (the promoteToHt pattern): this writes MONEY
  // and stamps cost_confirmed_at, so it is a deliberate press of its own rather
  // than a side effect of บันทึก. The sheet stays open; refresh re-renders the row.
  async function confirmCost() {
    if (pickedLevel === null || previewRate === null) return;
    setConfirmBusy(true);
    setError(null);
    const result = await confirmWorkerCost({ id: worker.id, level: pickedLevel });
    setConfirmBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Re-assert the surface (fresh-eyes 🔴): the sheet stays open and its `rate`
    // state predates the confirm — left stale, the next บันทึก would diff against
    // the refreshed worker.day_rate and setWorkerDayRate the OLD value back,
    // silently wiping the standard just stamped while ยืนยันแล้ว keeps rendering.
    setRate(String(previewRate));
    router.refresh();
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
    // Spec 362 U3 — the /catalog card row. min-w-40 (never min-w-0) with a
    // wrapping row, so the two fixed controls push below the name instead of
    // squeezing it to one character per line on a phone (feedback 65de06ca).
    <li className="border-edge bg-card rounded-control flex flex-wrap items-center gap-3 border px-4 py-3">
      <div className="min-w-40 flex-1">
        <div>
          <p
            className={`text-body ${optimisticActive ? "text-ink" : "text-ink-muted"} font-semibold`}
          >
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
            {/* Spec 395 U2: the payout account is not this worker's own and nobody
                has recorded who it belongs to. An INVITATION, not a fault — a family
                member's account is normal here; what is missing is the record.
                ⚠️ `text-action`, never `text-ink-muted`: that token is
                dividers/placeholder/disabled only (globals.css), and this is a line
                the reader is meant to act on. */}
            {worker.payoutAccount?.state === "unrecorded" ? (
              <span className="text-action ml-1.5 text-xs font-medium">
                ·{" "}
                {worker.payoutAccount.nameMatches
                  ? PAYOUT_ACCOUNT_SHARED_BADGE
                  : PAYOUT_ACCOUNT_UNRECORDED_BADGE}
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
      </div>
      {/* Both controls carry the worker's NAME in their accessible name: a roster
          of 29 rows otherwise offers 29 buttons all called แก้ไข, which is
          ambiguous for a screen reader and for anyone driving by voice. */}
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
        {/* Spec 374 U1 — door to the per-worker attendance calendar. ?from
            keeps the calendar's back chip returning HERE (multi-parent detail:
            /payroll links there too). flex-wrap: three controls overflow a
            320px card otherwise (clipped by main's overflow-x-clip). */}
        <Link
          href={`/workers/${worker.id}/attendance?from=/workers`}
          aria-label={`${ATTENDANCE_CALENDAR_LABEL} ${worker.name}`}
          className={BUTTON_SECONDARY_COMPACT}
        >
          ปฏิทิน
        </Link>
        <button
          type="button"
          aria-label={`แก้ไข ${worker.name}`}
          onClick={openEditor}
          className={BUTTON_SECONDARY_COMPACT}
        >
          แก้ไข
        </button>
        <button
          type="button"
          disabled={isToggling}
          aria-label={`${optimisticActive ? "ปิดใช้งาน" : "เปิดใช้งาน"} ${worker.name}`}
          onClick={toggleActive}
          className={BUTTON_SECONDARY_COMPACT}
        >
          {optimisticActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
        </button>
      </div>

      <BottomSheet open={editing} title={`แก้ไข ${worker.name}`} onClose={() => setEditing(false)}>
        <div>
          <label className="text-ink-secondary block text-sm">
            ชื่อ
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className={FIELD_STACKED}
              // The ownership line is a sibling of this input, so a screen reader
              // would otherwise announce only "ชื่อ" — and a non-sighted editor is
              // exactly who most needs to know whose record this is.
              {...(worker.portalBound ? { "aria-describedby": ownerHintId } : {})}
            />
          </label>
          {/* Spec 396 U2 — say WHOSE record this is, at the field where the
              mistake is made. Deliberately here rather than in the portal card
              further down the sheet: the 2026-08-04 rename happened in this
              input, and nobody scrolls to the bottom to find out who owns the
              row. States a fact; never warns — ten of the eleven real renames
              on bound workers were legitimate normalisations.
              text-ink-secondary, NOT ink-muted: this is copy a person must READ
              to avoid editing the wrong human's record. ink-muted is reserved
              for dividers/placeholder/disabled (globals.css:87) and the
              UX-audit G2 ratchet enforces it — it caught this line. */}
          {worker.portalBound ? (
            <p id={ownerHintId} className="text-ink-secondary mt-1 text-xs">
              {worker.boundUserName
                ? workerBoundOwnerLabel(worker.boundUserName)
                : WORKER_BOUND_OWNER_UNKNOWN}
            </p>
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
          {/* Spec 357 U-F: เพศ — optional; the stored value pre-selects. */}
          <div className="mt-2">
            <p className="text-ink-secondary text-sm">เพศ</p>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="เพศ">
              {(["male", "female"] as const).map((value) => (
                <RadioChip
                  key={value}
                  name={`edit-gender-${worker.id}`}
                  label={WORKER_GENDER_LABEL[value]}
                  checked={gender === value}
                  onSelect={() => setGender(value)}
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
                <p className="text-ink-secondary mt-1 text-xs">
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
              onChange={(e) => {
                setTaxId(e.target.value);
                // A refusal that NAMES a person must die with the value that caused
                // it, or the door points at someone unrelated (#945).
                if (duplicate) {
                  setDuplicate(null);
                  setError(null);
                }
              }}
              maxLength={50}
              className={FIELD_STACKED}
            />
          </label>
          {/* Spec 395 U2 — sits ABOVE the bank block on purpose, and outside the
              portalBound split so it renders for BOTH arms. Of the 8 live cases, 2 are
              portal-bound: their bank fields cannot be edited at all, so "correct the
              account" is not an available answer for them. Recording a บัญชีตัวแทน is
              the one route that resolves every case.
              ⚠️ The CTA DEEP-LINKS with ?worker=. It must: the nominee picker lists
              only workers with NO bank of their own ("เลือกช่างที่ยังไม่มีบัญชีธนาคารของตัวเอง"),
              and every worker this badge fires on HAS one — so without the parameter
              none of them can be selected through the normal flow at all. */}
          {worker.payoutAccount?.state === "unrecorded" ? (
            <div className="border-attn-edge bg-attn-soft rounded-control mt-3 border p-3">
              <p className="text-attn-ink text-sm font-medium">
                {worker.payoutAccount.nameMatches
                  ? PAYOUT_ACCOUNT_SHARED_BADGE
                  : PAYOUT_ACCOUNT_UNRECORDED_BADGE}
              </p>
              <p className="text-ink-secondary mt-1 text-sm">
                {worker.payoutAccount.nameMatches
                  ? PAYOUT_ACCOUNT_OWNER_SHARED_HINT
                  : PAYOUT_ACCOUNT_THIRD_PARTY_HINT}
              </p>
              {/* Spec 395 U4 — the fact that tells a third party from a typo, and the one
                  thing the app never showed. §5's three outcomes (confirm own / record a
                  nominee / correct a typo) are indistinguishable without it. */}
              <p className="text-ink-secondary mt-1 text-sm">
                {worker.payoutAccount.sharedWith.length > 0
                  ? `${PAYOUT_ACCOUNT_SHARED_WITH_PREFIX} ${worker.payoutAccount.sharedWith.join(", ")}`
                  : PAYOUT_ACCOUNT_SHARED_WITH_NOBODY}
              </p>
              {/* ⚠️ No CTA on the OWNER's row: the account IS theirs, so there is no
                  nominee to record and a link would invite fabricated data. The action
                  belongs to the OTHER rows sharing this account. */}
              {worker.payoutAccount.nameMatches ? null : (
                <Link
                  href={`/settings/payout-nominees/edit?worker=${worker.id}`}
                  className="text-action mt-2 inline-flex min-h-11 items-center text-sm font-medium underline"
                >
                  {PAYOUT_ACCOUNT_RECORD_CTA}
                </Link>
              )}
            </div>
          ) : null}
          {/* Bank: editable ONLY for an unbound worker. Once the ช่าง binds a portal
              login they own their bank via the request → PM-approval flow, so a
              back-office edit here would bypass that trail — show a notice instead.
              (update_worker's direct-bank write is intentionally left unchanged.) */}
          {worker.portalBound ? (
            <div className="mt-2">
              <p className="text-ink-secondary text-sm">ธนาคาร</p>
              <p className="text-ink-secondary mt-1 text-sm">รออนุมัติจากคำขอของช่าง</p>
            </div>
          ) : (
            <>
              {/* Spec 395 U3 — asked HERE, beside the fields where a third-party
                  account is actually typed. U1 detects and U2 badges, but both act on
                  what is already stored; the person entering the account never passes
                  the nominee control at /settings/payout-nominees, which §2 argues is a
                  leading reason that table has 0 rows all-time.
                  ⚠️ NOT PERSISTED (§4 forbids a new column). It routes and records
                  nothing — the detector re-derives the truth from the account itself, so
                  a wrong or skipped answer costs nothing and cannot become a stale
                  "someone said this was fine" flag.
                  ⚠️ Not shown for a portal-bound worker: their bank is owned through the
                  request → approval flow, so there is nothing to route and the question
                  would be noise. */}
              {/* ⚠️ Suppressed when U2's block is already showing. For an `unrecorded`
                  worker the sheet would otherwise say "บัญชีนี้อาจไม่ใช่ของช่างเอง" and then,
                  40px below, pre-check "ของช่างเอง" — answering its own question the
                  opposite way — and a second identical CTA would stack under the first.
                  U2 owns that conversation; U3 asks only where nothing is known yet. */}
              {worker.payoutAccount?.state === "unrecorded" ? null : (
                <>
                  <p className="text-ink-secondary mt-3 text-sm">{PAYOUT_ACCOUNT_OWNER_QUESTION}</p>
                  <div
                    role="radiogroup"
                    aria-label={PAYOUT_ACCOUNT_OWNER_QUESTION}
                    className="mt-1 flex flex-wrap gap-2"
                  >
                    {/* ⚠️ Per-INSTANCE group name (spec 392 U2a): a hardcoded one makes
                        every row's radios a single group, so answering on one sheet
                        silently clears another. */}
                    <RadioChip
                      name={`payout-owner-${worker.id}`}
                      label={PAYOUT_ACCOUNT_OWNER_SELF}
                      checked={!bankOwnerIsOther}
                      onSelect={() => setBankOwnerIsOther(false)}
                    />
                    <RadioChip
                      name={`payout-owner-${worker.id}`}
                      label={PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE}
                      checked={bankOwnerIsOther}
                      onSelect={() => setBankOwnerIsOther(true)}
                    />
                  </div>
                  {bankOwnerIsOther ? (
                    <div className="border-attn-edge bg-attn-soft rounded-control mt-2 border p-3">
                      <p className="text-ink-secondary text-sm">
                        {PAYOUT_ACCOUNT_OWNER_SOMEONE_ELSE_HINT}
                      </p>
                      {/* ⚠️ Navigating away DISCARDS whatever is typed in this sheet, and
                          the premise of this unit is that the account is being typed right
                          now — so the copy tells the editor to save first rather than
                          letting them lose the fields and land on the OLD account. */}
                      <Link
                        href={`/settings/payout-nominees/edit?worker=${worker.id}`}
                        className="text-action mt-2 inline-flex min-h-11 items-center text-sm font-medium underline"
                      >
                        {PAYOUT_ACCOUNT_RECORD_CTA}
                      </Link>
                    </div>
                  ) : null}
                </>
              )}
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
          {/* Spec 369 U1 — the cost-confirm door. Sits with the grade picker because
              it confirms THAT pick; super_admin only, mirroring confirm_worker_cost's
              own gate (offering it wider would be affordance-then-refuse). Until a
              worker is confirmed, derive_muster_labor produces no labor_logs for him
              at all — this button is the whole feed for the ADR-0060 engines. */}
          {canGrade && confirmable ? (
            <div className="mt-2">
              {/* The stamp certifies the CONFIRMED level+rate pairing — once a
                  different level is picked, the badge would vouch for a pairing
                  the operator is replacing, so the preview takes over instead. */}
              {worker.cost_confirmed_at !== null && pickedLevel === worker.level ? (
                <p className="text-ink-secondary text-xs font-medium">ยืนยันแล้ว</p>
              ) : null}
              {pickedLevel !== null && previewRate === null ? (
                <p className="text-attn-ink text-xs">
                  ยังไม่ได้ตั้งค่าแรงมาตรฐานของระดับนี้ — ตั้งที่ ค่าแรงมาตรฐาน ก่อน
                </p>
              ) : previewRate !== null ? (
                <p className="text-ink-muted text-xs">
                  จะบันทึกค่าแรง {previewRate.toLocaleString("th-TH")} บาท/วัน
                </p>
              ) : null}
              <button
                type="button"
                disabled={confirmBusy || pickedLevel === null || previewRate === null}
                onClick={() => void confirmCost()}
                className={`mt-1 ${BUTTON_SECONDARY_COMPACT}`}
              >
                {CONFIRM_COST_LABEL}
              </button>
            </div>
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
          {error ? (
            <p className="text-danger mt-2 text-sm" role="alert">
              {error}
            </p>
          ) : null}
          {/* Parity with the add sheet (#945): a permanent refusal hands over the row
              it is talking about instead of describing it. */}
          {duplicate ? (
            <button
              type="button"
              onClick={() => onShowExisting(duplicate.name)}
              className={`mt-2 w-full ${BUTTON_SECONDARY_COMPACT}`}
            >
              ดูช่างคนเดิม
            </button>
          ) : null}
          {/* Spec 396 U3 — the one question, asked where the save is pressed.
              It names the account holder and both names, because "are you sure?"
              is exactly the prompt people click through; the answerable version
              states who owns the record and what it is about to become. It does
              NOT accuse — renaming a bound worker is usually correct work, and
              this path only opens when the person appears to change. */}
          {pendingRename !== null ? (
            <div role="alert" className="border-attn bg-attn-soft mt-3 rounded-lg border p-3">
              <p className="text-attn-ink text-sm font-semibold">
                {worker.boundUserName
                  ? workerBoundOwnerLabel(worker.boundUserName)
                  : WORKER_BOUND_OWNER_UNKNOWN}
              </p>
              <p className="text-attn-ink mt-1 text-sm">
                กำลังจะเปลี่ยนชื่อจาก “{worker.name}” เป็น “{pendingRename}”
              </p>
              <p className="text-attn-ink mt-1 text-sm font-semibold">เป็นคนเดียวกันหรือไม่</p>
              {/* Symmetric answers: a yes/no question whose only "no" is a
                  cancel invites the wrong press. Both buttons answer the
                  question that was actually asked. */}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  // autoFocus so the question is where the keyboard and the
                  // screen reader already are — the panel opens in response to
                  // a press, and role="alert" announces but never moves focus.
                  autoFocus
                  disabled={busy}
                  onClick={() => void save({ confirmed: true })}
                  className={BUTTON_PRIMARY_COMPACT}
                >
                  ใช่ เปลี่ยนชื่อ
                </button>
                <button
                  type="button"
                  // Also busy-gated: without it, pressing this while the
                  // confirmed write is in flight hides the panel and the
                  // operator reads "declined" while the rename lands.
                  disabled={busy}
                  onClick={() => setPendingRename(null)}
                  className={BUTTON_SECONDARY_COMPACT}
                >
                  ไม่ใช่ คนละคน
                </button>
              </div>
            </div>
          ) : null}
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
                <p className="text-ink-secondary text-xs">กำหนดโครงการก่อนจึงตั้งหัวหน้าช่างได้</p>
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
      </BottomSheet>
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
  levelRates = NO_LEVEL_RATES,
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
  // Spec 332: PM_ROLES edit trades; the W01–W11 options the sheet offers.
  canSetTrades?: boolean;
  tradeOptions?: TradeOption[];
  // Spec 369 U1: gross standard rate per level (the cost-confirm preview).
  levelRates?: LevelRates;
}) {
  const [query, setQuery] = useState("");
  const [selectedPay, setSelectedPay] = useState<PayType | typeof ALL>(ALL);
  // Spec 395 U4: narrow to the accounts needing review. Off by default — the roster's
  // job is the roster; this is a worklist you opt into.
  const [reviewOnly, setReviewOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  const contractorNames = new Map(contractors.map((c) => [c.id, c.name]));
  // Spec 328 firm move — the edit sheet's assign/move targets: ACTIVE firms only
  // (spec-89 discipline: blacklisted/probation crews never join pickers).
  const activeFirms = contractors
    .filter((c) => c.status === "active")
    .map((c) => ({ id: c.id, name: c.name }));
  // Spec 266 U3 grouped the roster by การจ่าย / pay_type (no legacy own/contractor
  // vocabulary); spec 362 U3 keeps that grouping but derives it from the SEARCHED
  // set below, so the section counts follow what is on screen.
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

  // Spec 362 U3 — search across the three things the office actually looks a
  // ช่าง up by: their name, the phone number that just called, and the trade
  // they do (by code AND by Thai name — nobody remembers "W03").
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const searched = !searching
    ? workers
    : workers.filter((w) =>
        `${w.name} ${w.phone ?? ""} ${w.trades.map((t) => `${t.code} ${t.nameTh}`).join(" ")}`
          .toLowerCase()
          .includes(q),
      );

  // Spec 395 U4 — the review worklist, sited here rather than on a new settings page:
  // `/settings/payout-nominees` has ZERO route_views all-time while this page gets 686 in
  // 30 days, and a worklist nobody opens is not a shipped feature (spec 396 U4).
  // ⚠️ Its OWN axis, deliberately: the chips below filter by การจ่าย, and folding this in
  // would mean you cannot review accounts while keeping a pay-type filter — and picking
  // one would silently clear the other.
  const flaggedCount = searched.filter((w) => w.payoutAccount?.state === "unrecorded").length;
  const queried = reviewOnly
    ? searched.filter((w) => w.payoutAccount?.state === "unrecorded")
    : searched;

  const GROUPS = [
    { key: "monthly", label: "ช่างรายเดือน" },
    { key: "daily", label: "ช่างรายวัน" },
  ] as const;
  const countIn = (key: PayType) => queried.filter((w) => w.pay_type === key).length;
  const present = GROUPS.filter((g) => countIn(g.key) > 0);
  // A live search overrides the chip and searches the whole roster (the
  // /catalog rule): a stuck filter would make a search look like an absence.
  const sections =
    !searching && selectedPay !== ALL ? present.filter((g) => g.key === selectedPay) : present;

  const addDoor = (
    <div className="flex items-center justify-end">
      <button type="button" onClick={() => setAdding(true)} className={BUTTON_PRIMARY}>
        เพิ่มช่าง
      </button>
    </div>
  );

  // Field incident 2026-08-04: on a duplicate-เลขบัตร refusal the form hands back the
  // colliding ช่าง's name; searching for it is what actually puts their row on screen.
  // A live search overrides the การจ่าย chip (see `sections` above), so a stuck filter
  // cannot swallow the row we just promised.
  function showExistingWorker(name: string) {
    setQuery(name);
    setAdding(false);
  }

  const addSheet = (
    <BottomSheet open={adding} title="เพิ่มช่างใหม่" onClose={() => setAdding(false)}>
      <AddWorkerForm
        projects={projects}
        roster={workers}
        onShowExisting={showExistingWorker}
        onDone={() => setAdding(false)}
      />
    </BottomSheet>
  );

  // The roster used to render NOTHING below the form when it was empty.
  if (workers.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {addDoor}
        <p className="text-ink-secondary text-body">ยังไม่มีช่างในทะเบียน</p>
        {addSheet}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {addDoor}

      <div className="relative">
        <Search
          aria-hidden
          className="text-ink-muted pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${FIELD_INPUT} pl-10`}
          placeholder="ค้นหาด้วยชื่อ เบอร์โทร หรือสายงาน"
          aria-label="ค้นหาช่าง"
          autoComplete="off"
        />
      </div>

      {/* Spec 395 U4 — a SEPARATE radiogroup from การจ่าย below (different axis), and
          rendered only when something is actually flagged: an always-on "(0)" chip is
          noise on the 35 of 43 rows that are fine. */}
      {flaggedCount > 0 ? (
        <div
          className="flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto pb-1"
          role="radiogroup"
          aria-label={PAYOUT_ACCOUNT_REVIEW_FILTER}
        >
          <RadioChip
            name="worker-payout-review"
            label={`${PAYOUT_ACCOUNT_REVIEW_FILTER_ALL} (${searched.length})`}
            checked={!reviewOnly}
            onSelect={() => setReviewOnly(false)}
          />
          <RadioChip
            name="worker-payout-review"
            label={`${PAYOUT_ACCOUNT_REVIEW_FILTER} (${flaggedCount})`}
            checked={reviewOnly}
            onSelect={() => setReviewOnly(true)}
          />
        </div>
      ) : null}

      <div
        className="flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto pb-1"
        role="radiogroup"
        aria-label="กรองตามการจ่าย"
      >
        <RadioChip
          name="worker-pay-type"
          label={`ทั้งหมด (${queried.length})`}
          checked={selectedPay === ALL}
          onSelect={() => setSelectedPay(ALL)}
        />
        {present.map((g) => (
          <RadioChip
            key={g.key}
            name="worker-pay-type"
            label={`${g.label} (${countIn(g.key)})`}
            checked={selectedPay === g.key}
            onSelect={() => setSelectedPay(g.key)}
          />
        ))}
      </div>

      {searching && queried.length === 0 ? (
        <p className="text-ink-secondary text-body">ไม่พบช่างที่ค้นหา</p>
      ) : null}

      <div className="flex flex-col gap-6">
        {sections.map((g) => {
          const list = queried.filter((w) => w.pay_type === g.key);
          return (
            <section key={g.key} className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">
                {g.label} <span className="text-ink-muted">({list.length})</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {list.map((w) => (
                  <WorkerRow
                    key={w.id}
                    worker={w}
                    contractorName={
                      w.contractor_id ? (contractorNames.get(w.contractor_id) ?? null) : null
                    }
                    firms={activeFirms}
                    projects={projects}
                    // The WHOLE roster, never the searched subset — a stale filter
                    // must not hide a collision the DB will still refuse.
                    roster={workers}
                    onShowExisting={showExistingWorker}
                    canGrade={canGrade}
                    canAssignHt={canAssignHt}
                    canSetTrades={canSetTrades}
                    tradeOptions={tradeOptions}
                    levelRates={levelRates}
                    htCodes={htCodesByWorker.get(w.id) ?? []}
                    currentProjectHt={currentProjectHtOf(w)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {addSheet}
    </div>
  );
}
