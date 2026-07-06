"use client";

// Spec 273 U2 (ADR 0076) — the /sa แผนพรุ่งนี้ board builder. 'use client' because
// it drives the five U1 RPCs (add/remove/set-note/reorder/set-crew) through local
// interaction state + router.refresh(). It is a SEPARATE daily-plan layer — it never
// touches the master schedule/baselines. Crew is a flexible per-leaf worker set with
// one ผู้รับผิดชอบงานย่อย (is_lead); no team entity in v1.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BUTTON_PRIMARY_COMPACT,
  CARD,
  FIELD_INPUT,
  FIELD_SELECT,
  SECTION_HEADING,
} from "@/lib/ui/classes";
import {
  DAILY_WORK_PLAN_LABEL,
  SUBWP_RESPONSIBLE_LABEL,
  WP_LEAF_LABEL,
  WORKER_LABEL,
} from "@/lib/i18n/labels";
import type { WpPickerGroups } from "@/lib/work-packages/picker-options";
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
  "inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-control border border-edge bg-card px-2 text-meta text-ink-secondary transition-colors hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-50";
const ROW_BTN_ON = "border-edge bg-fill text-on-fill hover:bg-fill-press";

export function DailyPlanBoard({
  projects,
  selectedProjectId,
  dateIso,
  dateLabel,
  planId,
  leafOptions,
  workers,
  items,
}: {
  projects: ProjectOption[];
  selectedProjectId: string;
  dateIso: string;
  dateLabel: string;
  planId: string | null;
  leafOptions: WpPickerGroups;
  workers: Worker[];
  items: DailyPlanItemView[];
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

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className={SECTION_HEADING}>{DAILY_WORK_PLAN_LABEL}</h1>
        <p className="text-body text-ink-muted">{dateLabel}</p>
        {hasPicker && (
          <select
            aria-label="เลือกโครงการ"
            className={`mt-1 ${FIELD_SELECT}`}
            value={selectedProjectId}
            onChange={(e) => router.push(`/sa/plan?project=${e.target.value}`)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {/* Add a งานย่อย to tomorrow's board. */}
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

      {items.length === 0 ? (
        <p className="text-body text-ink-muted">ยังไม่มี{WP_LEAF_LABEL}ในแผนพรุ่งนี้</p>
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
