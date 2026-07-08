"use client";

// Spec 281 U2 (extends ADR 0076) — the แนะนำแผนพรุ่งนี้ surface on /sa/plan.
// 'use client' because it drives local review state (which suggested rows + crews
// stay selected) before committing through the existing 273 RPCs. The engine's
// draft (U1) is computed server-side and handed in; this only renders it as board
// rows — every row + its crew PRE-CHECKED but not forced (D4) — and one-taps the
// still-selected rows into the board via applyPlanSuggestions. Nothing writes until
// ใช้ที่เลือก (D5): a bare read/propose until the SA approves.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyPlanSuggestions } from "@/app/sa/plan/actions";
import type { DraftItem } from "@/lib/sa/recommend-board";
import { BUTTON_PRIMARY_COMPACT, BUTTON_SECONDARY_COMPACT, CARD } from "@/lib/ui/classes";
import {
  APPLY_SELECTED_LABEL,
  CLEAR_CREW_LABEL,
  PICK_CREW_SELF_LABEL,
  SUGGEST_PLAN_LABEL,
} from "@/lib/i18n/labels";

const CHIP =
  "inline-flex w-fit items-center rounded-control bg-sunk px-2 py-0.5 text-meta text-ink-secondary";
const ROW_BTN =
  "inline-flex min-h-8 items-center justify-center rounded-control border border-edge bg-card px-2 text-meta text-ink-secondary transition-colors hover:bg-sunk disabled:opacity-50";

export function DailyPlanSuggestions({
  projectId,
  dateIso,
  draft,
}: {
  projectId: string;
  dateIso: string;
  draft: DraftItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(draft.map((d) => d.workPackageId)),
  );
  const [crewCleared, setCrewCleared] = useState<Set<string>>(new Set());

  const empty = draft.length === 0;

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearCrew = (id: string) => setCrewCleared((prev) => new Set(prev).add(id));

  async function onApply() {
    const selections = draft
      .filter((d) => selected.has(d.workPackageId))
      .map((d) => ({
        wp: d.workPackageId,
        crew:
          d.crew && !crewCleared.has(d.workPackageId)
            ? { workerIds: d.crew.workerIds, lead: d.crew.leadWorkerId }
            : null,
      }));
    if (selections.length === 0) return; // nothing to commit (D5)
    setBusy(true);
    try {
      const r = await applyPlanSuggestions(projectId, dateIso, selections);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        className={BUTTON_SECONDARY_COMPACT}
        disabled={empty || busy}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {SUGGEST_PLAN_LABEL}
      </button>

      {open && !empty && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {draft.map((d) => {
              const isSelected = selected.has(d.workPackageId);
              const crewKept = d.crew && !crewCleared.has(d.workPackageId);
              return (
                <li
                  key={d.workPackageId}
                  data-testid={`suggestion-${d.workPackageId}`}
                  className={`${CARD} flex flex-col gap-1.5`}
                >
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`${d.code} ${d.name}`}
                      checked={isSelected}
                      onChange={() => toggleRow(d.workPackageId)}
                    />
                    <span className="text-body text-ink flex-1 font-medium">
                      {d.code} {d.name}
                    </span>
                  </label>

                  <span className={CHIP}>{d.reason}</span>

                  {d.crew &&
                    (crewKept ? (
                      <div className="flex items-center gap-2">
                        <span className="text-meta text-ink-secondary flex-1">
                          {d.crew.crewName} · {d.crew.reason}
                        </span>
                        <button
                          type="button"
                          className={ROW_BTN}
                          aria-label={`${CLEAR_CREW_LABEL} ${d.code}`}
                          onClick={() => clearCrew(d.workPackageId)}
                        >
                          {CLEAR_CREW_LABEL}
                        </button>
                      </div>
                    ) : (
                      <span className="text-meta text-ink-muted">— {PICK_CREW_SELF_LABEL}</span>
                    ))}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className={`${BUTTON_PRIMARY_COMPACT} w-fit`}
            disabled={busy}
            onClick={onApply}
          >
            {APPLY_SELECTED_LABEL}
          </button>
        </div>
      )}
    </section>
  );
}
