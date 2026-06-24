"use client";

// Spec 176 U2/U3 + spec 181 U2 — the supply-plan planning screen. A planner (or
// procurement in the PM's stead, spec 181) builds the plan in an INLINE GRID:
// fill many rows (catalog item + WP + qty + note) and save them in ONE bulk
// write, then submits; an approver (PD/super) approves/rejects. A rejected plan
// is editable again. 'use client': the grid rows + the submit/remove/lifecycle
// transitions. The grid replaces the spec-176 one-at-a-time bottom sheet.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import type { Database } from "@/lib/db/database.types";
import { CatalogItemPicker } from "@/components/features/purchasing/catalog-item-picker";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";
import {
  approvePlan,
  bulkAddPlanLines,
  generatePlanPurchaseRequests,
  rejectPlan,
  removePlanLine,
  reopenPlan,
  submitPlan,
} from "@/app/projects/[projectId]/supply-plan/actions";

export type PlanStatus = Database["public"]["Enums"]["supply_plan_status"];

type LifecycleResult = { ok: true } | { ok: false; error: string };

// Spec 189 follow-up: the supply-plan item picker is now the SAME catalog picker
// as the purchase request (operator: "must match on-site PR"), so the rows take
// the thumbnail-bearing PR catalog item shape.
export type CatalogPick = PurchaseRequestCatalogItem;

export type PlanLine = {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
  wpLabel: string | null;
  // Spec 181 U4: a PR has already been generated from this line (idempotent).
  converted: boolean;
};

type DraftRow = {
  key: number;
  catalogItemId: string;
  workPackageId: string;
  qty: string;
  note: string;
};

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "ร่าง",
  submitted: "ส่งอนุมัติแล้ว",
  approved: "อนุมัติแล้ว",
  rejected: "ตีกลับ",
};

const LABEL = "text-meta text-ink-secondary font-medium";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action h-11 w-full min-w-0 border px-3 text-sm focus:outline-none focus-visible:ring-2";
const SELECT =
  "rounded-control border-edge-strong bg-card text-ink focus-visible:ring-action h-11 w-full min-w-0 border px-2 text-sm shadow-xs focus:outline-none focus-visible:ring-2";

let rowSeq = 0;
function blankRow(): DraftRow {
  rowSeq += 1;
  return { key: rowSeq, catalogItemId: "", workPackageId: "", qty: "", note: "" };
}

export function SupplyPlanManager({
  projectId,
  planId,
  planStatus,
  canApprove,
  canOverride,
  overriddenByName,
  lines,
  catalogItems,
  workPackages,
}: {
  projectId: string;
  planId: string | null;
  planStatus: PlanStatus | null;
  canApprove: boolean;
  // Spec 194: super_admin can reopen a frozen (submitted/approved) plan to edit it.
  canOverride: boolean;
  overriddenByName: string | null;
  lines: PlanLine[];
  catalogItems: CatalogPick[];
  workPackages: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  // Editable while draft/rejected (or before a plan exists); submitted/approved
  // are the frozen baseline.
  const editable = planStatus === null || planStatus === "draft" || planStatus === "rejected";

  const [rows, setRows] = useState<DraftRow[]>([blankRow()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [acting, startAct] = useTransition();
  const [actError, setActError] = useState<string | null>(null);

  // A row counts once it has an item + a positive qty; WP is optional (null =
  // whole-project). Blank / partial rows are ignored on save (a trailing empty
  // row is fine) — keeps fast multi-row entry forgiving.
  const validRows = rows.filter(
    (r) => r.catalogItemId !== "" && Number.isFinite(Number(r.qty)) && Number(r.qty) > 0,
  );
  const canSave = !saving && validRows.length > 0 && planId !== null;

  function patchRow(key: number, patch: Partial<DraftRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setError(null);
  }
  function addRow() {
    setRows((rs) => [...rs, blankRow()]);
  }
  function dropRow(key: number) {
    // Keep at least one row; clearing the last row resets it to blank.
    setRows((rs) =>
      rs.length > 1
        ? rs.filter((r) => r.key !== key)
        : rs.map((r) => (r.key === key ? blankRow() : r)),
    );
  }

  function handleSave() {
    if (!canSave || !planId) return;
    setError(null);
    startSave(async () => {
      const result = await bulkAddPlanLines({
        projectId,
        planId,
        lines: validRows.map((r) => ({
          catalogItemId: r.catalogItemId,
          workPackageId: r.workPackageId === "" ? null : r.workPackageId,
          qty: Number(r.qty),
          note: r.note,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRows([blankRow()]);
      router.refresh();
    });
  }

  function runLifecycle(
    fn: (i: { projectId: string; planId: string }) => Promise<LifecycleResult>,
  ) {
    if (!planId) return;
    setActError(null);
    startAct(async () => {
      const result = await fn({ projectId, planId });
      if (!result.ok) {
        setActError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleRemove(lineId: string) {
    setRemoveError(null);
    startRemove(async () => {
      const result = await removePlanLine({ projectId, lineId });
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
      router.refresh();
    });
  }

  // Spec 181 U4 / spec 195 P2: convert an APPROVED plan's lines into purchase
  // requests. Any not-yet-converted line is convertible — a WP-bound line becomes
  // a WP-bound PR, a whole-project line becomes a WP-less (store-bound) PR.
  const convertMode = planStatus === "approved";
  const convertible = lines.filter((l) => !l.converted);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, startGenerate] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  function toggleLine(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setGenError(null);
    setGenMsg(null);
  }
  const allSelected = convertible.length > 0 && convertible.every((l) => selected.has(l.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(convertible.map((l) => l.id)));
    setGenError(null);
    setGenMsg(null);
  }

  function handleGenerate() {
    if (!planId || selected.size === 0 || generating) return;
    setGenError(null);
    setGenMsg(null);
    startGenerate(async () => {
      const result = await generatePlanPurchaseRequests({
        projectId,
        planId,
        lineIds: [...selected],
      });
      if (!result.ok) {
        setGenError(result.error);
        return;
      }
      setSelected(new Set());
      setGenMsg(`สร้างคำขอซื้อแล้ว ${result.count ?? 0} รายการ`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-meta text-ink-secondary">
          สถานะแผน:{" "}
          <span className="text-ink font-semibold">
            {planStatus ? PLAN_STATUS_LABEL[planStatus] : "ยังไม่เริ่ม"}
          </span>
          {/* Spec 194: a permanent marker that this plan was force-reopened. */}
          {overriddenByName ? (
            <span className="text-attn-ink"> · ปรับแก้โดย {overriddenByName}</span>
          ) : null}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {/* Spec 194: super_admin reopens a frozen plan (submitted/approved) to
              edit it — the operator escape hatch, audited by the overridden stamp. */}
          {canOverride && planId && (planStatus === "submitted" || planStatus === "approved") ? (
            <button
              type="button"
              disabled={acting}
              onClick={() => runLifecycle(reopenPlan)}
              className={BUTTON_SECONDARY}
            >
              {acting ? "กำลังเปิด…" : "เปิดแก้ไข (ผู้ดูแลระบบ)"}
            </button>
          ) : null}
          {editable && planId ? (
            <button
              type="button"
              disabled={acting}
              onClick={() => runLifecycle(submitPlan)}
              className={BUTTON_PRIMARY}
            >
              {acting ? "กำลังส่ง…" : "ส่งอนุมัติ"}
            </button>
          ) : null}
          {planStatus === "submitted" && canApprove ? (
            <>
              <button
                type="button"
                disabled={acting}
                onClick={() => runLifecycle(rejectPlan)}
                className={BUTTON_SECONDARY}
              >
                ตีกลับ
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => runLifecycle(approvePlan)}
                className={BUTTON_PRIMARY}
              >
                อนุมัติ
              </button>
            </>
          ) : null}
          {planStatus === "submitted" && !canApprove ? (
            <span className="text-meta text-ink-secondary">รออนุมัติ</span>
          ) : null}
        </div>
      </div>

      {actError ? (
        <div role="alert" className={INLINE_ERROR}>
          {actError}
        </div>
      ) : null}
      {removeError ? (
        <div role="alert" className={INLINE_ERROR}>
          {removeError}
        </div>
      ) : null}

      {/* Saved lines (the plan so far). */}
      {lines.length === 0 ? (
        <p className="text-ink-secondary text-body">ยังไม่มีรายการในแผน</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li
              key={l.id}
              className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
            >
              {convertMode && !l.converted ? (
                <input
                  type="checkbox"
                  aria-label={`เลือก ${l.baseItem}`}
                  checked={selected.has(l.id)}
                  onChange={() => toggleLine(l.id)}
                  disabled={generating}
                  className="accent-action size-5 shrink-0"
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="text-ink text-body block font-semibold">{l.baseItem}</span>
                <span className="text-ink-secondary text-meta block">
                  {l.specAttrs ? `${l.specAttrs} · ` : ""}
                  {l.wpLabel ?? "ทั้งโครงการ"}
                </span>
              </span>
              <span className="text-ink text-body shrink-0 font-semibold">
                {l.qty} {l.unit}
              </span>
              {convertMode && l.converted ? (
                <span className="bg-sunk text-done-strong text-meta rounded-control shrink-0 px-2 py-1 font-medium">
                  สร้าง PR แล้ว
                </span>
              ) : null}
              {editable ? (
                <button
                  type="button"
                  aria-label="ลบ"
                  disabled={removing}
                  onClick={() => handleRemove(l.id)}
                  className="text-ink-muted hover:text-ink focus-visible:ring-action shrink-0 rounded-md p-1 focus:outline-none focus-visible:ring-2"
                >
                  <Trash2 aria-hidden className="size-5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* Spec 181 U4: convert an approved plan's lines into purchase requests. */}
      {convertMode ? (
        <div className="border-edge bg-page rounded-control flex flex-col gap-3 border p-3">
          <p className="text-ink text-sm font-semibold">สร้างคำขอซื้อจากแผน</p>
          {genError ? (
            <div role="alert" className={INLINE_ERROR}>
              {genError}
            </div>
          ) : null}
          {genMsg ? (
            <p role="status" className="text-done-strong text-sm font-medium">
              {genMsg}
            </p>
          ) : null}
          {convertible.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-ink-secondary inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label="เลือกทั้งหมด"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={generating}
                  className="accent-action size-5"
                />
                เลือกทั้งหมด
              </label>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={selected.size === 0 || generating}
                className={BUTTON_PRIMARY}
              >
                {generating ? "กำลังสร้าง…" : `สร้างคำขอซื้อ (${selected.size})`}
              </button>
            </div>
          ) : (
            <p className="text-ink-secondary text-meta">ทุกรายการที่มีงานถูกสร้างคำขอซื้อแล้ว</p>
          )}
        </div>
      ) : null}

      {/* Spec 181 U2: the inline grid — fill many rows, save in one bulk write. */}
      {editable ? (
        <div className="border-edge bg-page rounded-control flex flex-col gap-3 border p-3">
          <p className="text-ink text-sm font-semibold">เพิ่มรายการแผน (กรอกได้หลายแถว)</p>
          {rows.map((r) => (
            <div
              key={r.key}
              className="border-edge bg-card rounded-control flex flex-col gap-2 border p-3 sm:flex-row sm:items-end"
            >
              <div className="flex min-w-0 flex-[2] flex-col gap-1">
                <CatalogItemPicker
                  label="วัสดุ"
                  items={catalogItems}
                  selectedId={r.catalogItemId}
                  onSelect={(id) => patchRow(r.key, { catalogItemId: id })}
                  onClear={() => patchRow(r.key, { catalogItemId: "" })}
                  disabled={saving}
                />
              </div>
              <div className="flex min-w-0 flex-[2] flex-col gap-1">
                <label htmlFor={`spl-wp-${r.key}`} className={LABEL}>
                  งาน
                </label>
                <select
                  id={`spl-wp-${r.key}`}
                  aria-label="งาน"
                  value={r.workPackageId}
                  onChange={(e) => patchRow(r.key, { workPackageId: e.target.value })}
                  disabled={saving}
                  className={SELECT}
                >
                  <option value="">ทั้งโครงการ</option>
                  {workPackages.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex w-full min-w-0 flex-col gap-1 sm:w-24">
                <label htmlFor={`spl-qty-${r.key}`} className={LABEL}>
                  จำนวน
                </label>
                <input
                  id={`spl-qty-${r.key}`}
                  aria-label="จำนวน"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={r.qty}
                  onChange={(e) => patchRow(r.key, { qty: e.target.value })}
                  disabled={saving}
                  className={FIELD}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={`spl-note-${r.key}`} className={LABEL}>
                  หมายเหตุ
                </label>
                <input
                  id={`spl-note-${r.key}`}
                  aria-label="หมายเหตุ"
                  type="text"
                  maxLength={1000}
                  value={r.note}
                  onChange={(e) => patchRow(r.key, { note: e.target.value })}
                  disabled={saving}
                  className={FIELD}
                />
              </div>
              <button
                type="button"
                aria-label="เอาแถวออก"
                disabled={saving}
                onClick={() => dropRow(r.key)}
                className="text-ink-muted hover:text-ink focus-visible:ring-action mb-1 shrink-0 self-end rounded-md p-1 focus:outline-none focus-visible:ring-2"
              >
                <Trash2 aria-hidden className="size-5" />
              </button>
            </div>
          ))}

          {error ? (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={addRow}
              disabled={saving}
              className={`${BUTTON_SECONDARY} inline-flex items-center gap-1`}
            >
              <Plus aria-hidden className="size-4" /> เพิ่มแถว
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={BUTTON_PRIMARY}
            >
              {saving
                ? "กำลังบันทึก…"
                : `บันทึก${validRows.length > 0 ? ` ${validRows.length} รายการ` : ""}`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
