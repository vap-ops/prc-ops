"use client";

// Spec 176 U2 — the supply-plan planning screen. A planner adds lines (catalog
// item + work package + qty) to a project's DRAFT plan and removes them; a
// submitted/approved plan is the frozen baseline (read-only here). 'use client':
// the add-sheet state, qty/select state, submit + remove transitions, refresh.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INLINE_ERROR } from "@/lib/ui/classes";
import { ITEM_CATEGORY_LABEL } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";
import { addPlanLine, removePlanLine } from "@/app/projects/[projectId]/supply-plan/actions";

type ItemCategory = Database["public"]["Enums"]["item_category"];
type PlanStatus = Database["public"]["Enums"]["supply_plan_status"];

export type CatalogPick = {
  id: string;
  category: ItemCategory;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
};

export type PlanLine = {
  id: string;
  baseItem: string;
  specAttrs: string | null;
  unit: string;
  qty: number;
  wpLabel: string | null;
};

const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "ร่าง",
  submitted: "ส่งอนุมัติแล้ว",
  approved: "อนุมัติแล้ว",
  rejected: "ตีกลับ",
};

const LABEL = "text-sm font-medium text-ink";
const FIELD =
  "rounded-control border-edge-strong bg-card text-ink shadow-input focus-visible:ring-action w-full min-w-0 border px-3 py-2 text-sm focus:outline-none focus-visible:ring-2";

export function SupplyPlanManager({
  projectId,
  planStatus,
  lines,
  catalogItems,
  workPackages,
}: {
  projectId: string;
  planStatus: PlanStatus | null;
  lines: PlanLine[];
  catalogItems: CatalogPick[];
  workPackages: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const editable = planStatus === null || planStatus === "draft";

  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [wp, setWp] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const qtyNum = Number(qty);
  const canSubmit =
    item !== "" && wp !== "" && Number.isFinite(qtyNum) && qtyNum > 0 && !submitting;

  const categories = Object.keys(ITEM_CATEGORY_LABEL) as ItemCategory[];

  function reset() {
    setItem("");
    setWp("");
    setQty("");
    setNote("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    startSubmit(async () => {
      const result = await addPlanLine({
        projectId,
        catalogItemId: item,
        workPackageId: wp,
        qty: qtyNum,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-meta text-ink-secondary">
          สถานะแผน:{" "}
          <span className="text-ink font-semibold">
            {planStatus ? STATUS_LABEL[planStatus] : "ยังไม่เริ่ม"}
          </span>
        </span>
        {editable ? (
          <button type="button" onClick={() => setOpen(true)} className={BUTTON_PRIMARY}>
            เพิ่มรายการแผน
          </button>
        ) : null}
      </div>

      {removeError ? (
        <div role="alert" className={INLINE_ERROR}>
          {removeError}
        </div>
      ) : null}

      {lines.length === 0 ? (
        <p className="text-ink-secondary text-body">ยังไม่มีรายการในแผน</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li
              key={l.id}
              className="border-edge bg-card rounded-control flex items-center gap-3 border px-4 py-3"
            >
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

      <BottomSheet open={open} title="เพิ่มรายการแผน" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="spl-item" className={LABEL}>
              วัสดุ
            </label>
            <select
              id="spl-item"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">เลือกวัสดุ</option>
              {categories.map((c) => {
                const opts = catalogItems.filter((ci) => ci.category === c);
                if (opts.length === 0) return null;
                return (
                  <optgroup key={c} label={ITEM_CATEGORY_LABEL[c]}>
                    {opts.map((ci) => (
                      <option key={ci.id} value={ci.id}>
                        {ci.baseItem}
                        {ci.specAttrs ? ` · ${ci.specAttrs}` : ""} ({ci.unit})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="spl-wp" className={LABEL}>
              งาน
            </label>
            <select
              id="spl-wp"
              value={wp}
              onChange={(e) => setWp(e.target.value)}
              disabled={submitting}
              className={FIELD}
            >
              <option value="">เลือกงาน (WP)</option>
              {workPackages.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="spl-qty" className={LABEL}>
              จำนวน
            </label>
            <input
              id="spl-qty"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={submitting}
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="spl-note" className={LABEL}>
              หมายเหตุ (ถ้ามี)
            </label>
            <input
              id="spl-note"
              type="text"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              className={FIELD}
            />
          </div>

          {error ? (
            <div role="alert" className={INLINE_ERROR}>
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BUTTON_SECONDARY}>
              ยกเลิก
            </button>
            <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
              {submitting ? "กำลังเพิ่ม…" : "เพิ่ม"}
            </button>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
