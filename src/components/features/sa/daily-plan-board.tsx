"use client";

// Spec 273 U2 (ADR 0076) — the /sa แผนพรุ่งนี้ board builder. 'use client' because
// it drives the five U1 RPCs (add/remove/set-note/reorder/set-crew) through local
// interaction state + router.refresh(). It is a SEPARATE daily-plan layer — it never
// touches the master schedule/baselines. Crew is a flexible per-leaf worker set with
// one ผู้รับผิดชอบงานย่อย (is_lead); no team entity in v1.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BUTTON_PRIMARY_COMPACT, CARD, FIELD_INPUT, FIELD_SELECT } from "@/lib/ui/classes";
import {
  SUBWP_RESPONSIBLE_LABEL,
  TODAY_LABEL,
  TOMORROW_LABEL,
  WP_LEAF_LABEL,
  WORKER_LABEL,
} from "@/lib/i18n/labels";
import { addDaysIso } from "@/lib/work-packages/calendar-grid";
import type { WpPickerGroups } from "@/lib/work-packages/picker-options";
import type { DraftItem } from "@/lib/sa/recommend-board";
import { DailyPlanSuggestions } from "@/components/features/sa/daily-plan-suggestions";
import {
  addDailyPlanItem,
  removeDailyPlanItem,
  setDailyPlanItemNote,
  reorderDailyPlanItems,
  setDailyPlanItemCrew,
} from "@/app/sa/plan/actions";

export type DailyPlanItemView = {
  id: string;
  workPackageId: string;
  code: string;
  name: string;
  note: string;
  crew: { workerId: string; isLead: boolean }[];
};

type Worker = { id: string; name: string };
type ProjectOption = { id: string; code: string; name: string };
type CrewState = { ids: Set<string>; lead: string | null };

const ROW_BTN =
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control border border-edge bg-card px-2 text-meta text-ink-secondary transition-colors hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-50";
const ROW_BTN_ON = "border-edge bg-fill text-on-fill hover:bg-fill-press";

export function DailyPlanBoard({
  projects,
  selectedProjectId,
  today,
  dateIso,
  dateLabel,
  planId,
  leafOptions,
  workers,
  items,
  suggestions = [],
}: {
  projects: ProjectOption[];
  selectedProjectId: string;
  today: string;
  dateIso: string;
  dateLabel: string;
  planId: string | null;
  leafOptions: WpPickerGroups;
  workers: Worker[];
  items: DailyPlanItemView[];
  suggestions?: DraftItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [addWp, setAddWp] = useState("");

  // Local crew state so a chain of toggles composes before the server refresh.
  const [crew, setCrew] = useState<Record<string, CrewState>>(() =>
    Object.fromEntries(
      items.map((it) => [
        it.id,
        {
          ids: new Set(it.crew.map((c) => c.workerId)),
          lead: it.crew.find((c) => c.isLead)?.workerId ?? null,
        } satisfies CrewState,
      ]),
    ),
  );

  // Stable crew order = the workers-prop order (deterministic RPC payloads).
  const orderOf = (ids: Set<string>) => workers.filter((w) => ids.has(w.id)).map((w) => w.id);

  async function run(fn: () => Promise<{ ok: boolean }>) {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onAdd() {
    if (!addWp) return;
    await run(async () => {
      const r = await addDailyPlanItem(selectedProjectId, dateIso, addWp);
      if (r.ok) setAddWp("");
      return r;
    });
  }

  function onToggleWorker(itemId: string, workerId: string) {
    const cur = crew[itemId] ?? { ids: new Set<string>(), lead: null };
    const ids = new Set(cur.ids);
    let lead = cur.lead;
    if (ids.has(workerId)) {
      ids.delete(workerId);
      if (lead === workerId) lead = null;
    } else {
      ids.add(workerId);
    }
    setCrew((prev) => ({ ...prev, [itemId]: { ids, lead } }));
    void run(() => setDailyPlanItemCrew(itemId, orderOf(ids), lead));
  }

  function onResponsible(itemId: string, workerId: string) {
    const cur = crew[itemId] ?? { ids: new Set<string>(), lead: null };
    const ids = new Set(cur.ids);
    ids.add(workerId);
    setCrew((prev) => ({ ...prev, [itemId]: { ids, lead: workerId } }));
    void run(() => setDailyPlanItemCrew(itemId, orderOf(ids), workerId));
  }

  async function onMove(itemId: string, dir: -1 | 1) {
    if (!planId) return;
    const order = items.map((i) => i.id);
    const idx = order.indexOf(itemId);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= order.length) return;
    [order[idx], order[to]] = [order[to]!, order[idx]!];
    await run(() => reorderDailyPlanItems(planId, order));
  }

  const hasPicker = projects.length > 1;
  const anyLeaves = leafOptions.sections.length > 0 || leafOptions.ungrouped.length > 0;

  // Date stepper — the board is navigable day-to-day, floored at today (a SA never
  // edits a past day's plan). The page defaults the view to พรุ่งนี้.
  const planHref = (d: string) => `/sa/plan?project=${selectedProjectId}&date=${d}`;
  const atFloor = dateIso <= today;
  const relativeDay =
    dateIso === today ? TODAY_LABEL : dateIso === addDaysIso(today, 1) ? TOMORROW_LABEL : null;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={ROW_BTN}
            aria-label="วันก่อนหน้า"
            disabled={busy || atFloor}
            onClick={() => router.push(planHref(addDaysIso(dateIso, -1)))}
          >
            ←
          </button>
          <div className="flex flex-1 flex-col">
            {relativeDay && <span className="text-meta text-ink-muted">{relativeDay}</span>}
            <span className="text-body text-ink font-medium">{dateLabel}</span>
          </div>
          <button
            type="button"
            className={ROW_BTN}
            aria-label="วันถัดไป"
            disabled={busy}
            onClick={() => router.push(planHref(addDaysIso(dateIso, 1)))}
          >
            →
          </button>
        </div>
        {hasPicker && (
          <select
            aria-label="เลือกโครงการ"
            className={FIELD_SELECT}
            value={selectedProjectId}
            onChange={(e) => router.push(`/sa/plan?project=${e.target.value}&date=${dateIso}`)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {/* Add a งานย่อย to the selected day's board. */}
      <div className="flex items-center gap-2">
        <select
          aria-label="เพิ่มงานย่อย"
          className={FIELD_SELECT}
          value={addWp}
          onChange={(e) => setAddWp(e.target.value)}
          disabled={busy || !anyLeaves}
        >
          <option value="">— {WP_LEAF_LABEL} —</option>
          {leafOptions.sections.map((s) => (
            <optgroup key={s.label} label={s.label}>
              {s.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} {o.name}
                </option>
              ))}
            </optgroup>
          ))}
          {leafOptions.ungrouped.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} {o.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`${BUTTON_PRIMARY_COMPACT} shrink-0`}
          onClick={onAdd}
          disabled={busy || !addWp}
        >
          เพิ่ม
        </button>
      </div>

      {/* Spec 281 U2 — the แนะนำแผนพรุ่งนี้ recommender: a draft the SA reviews +
          one-taps into this board (its own selected rows), in place. */}
      <DailyPlanSuggestions projectId={selectedProjectId} dateIso={dateIso} draft={suggestions} />

      {items.length === 0 ? (
        <p className="text-body text-ink-muted">ยังไม่มี{WP_LEAF_LABEL}ในแผน</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it, idx) => {
            const state = crew[it.id] ?? { ids: new Set<string>(), lead: null };
            return (
              <li
                key={it.id}
                data-testid={`plan-item-${it.id}`}
                className={`${CARD} flex flex-col gap-2`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-body text-ink min-w-40 flex-1 font-medium">
                    {it.code} {it.name}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className={ROW_BTN}
                      aria-label="เลื่อนขึ้น"
                      disabled={busy || idx === 0}
                      onClick={() => onMove(it.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={ROW_BTN}
                      aria-label="เลื่อนลง"
                      disabled={busy || idx === items.length - 1}
                      onClick={() => onMove(it.id, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={ROW_BTN}
                      aria-label="ลบ"
                      disabled={busy}
                      onClick={() => run(() => removeDailyPlanItem(it.id))}
                    >
                      ลบ
                    </button>
                  </div>
                </div>

                <input
                  aria-label="บันทึก"
                  className={FIELD_INPUT}
                  defaultValue={it.note}
                  placeholder="บันทึก"
                  onBlur={(e) => {
                    if (e.target.value !== it.note) {
                      void run(() => setDailyPlanItemNote(it.id, e.target.value));
                    }
                  }}
                />

                <fieldset className="flex flex-col gap-1">
                  <legend className="text-meta text-ink-muted">
                    {WORKER_LABEL} · ★ = {SUBWP_RESPONSIBLE_LABEL}
                  </legend>
                  {workers.map((w) => {
                    const inCrew = state.ids.has(w.id);
                    const isLead = state.lead === w.id;
                    return (
                      <div key={w.id} className="flex items-center gap-2">
                        <label className="text-body text-ink flex flex-1 items-center gap-2">
                          <input
                            type="checkbox"
                            aria-label={w.name}
                            checked={inCrew}
                            onChange={() => onToggleWorker(it.id, w.id)}
                          />
                          {w.name}
                        </label>
                        <button
                          type="button"
                          className={`${ROW_BTN} ${isLead ? ROW_BTN_ON : ""}`}
                          aria-label={`ผู้รับผิดชอบ ${w.name}`}
                          aria-pressed={isLead}
                          onClick={() => onResponsible(it.id, w.id)}
                        >
                          ★
                        </button>
                      </div>
                    );
                  })}
                </fieldset>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
