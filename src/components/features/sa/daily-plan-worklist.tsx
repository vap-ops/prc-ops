"use client";

// Spec 273 U3 (ADR 0076) — the /sa morning "แผนวันนี้" worklist. Surfaces TODAY's
// daily-plan board (the งานย่อย SA queued yesterday) with a one-tap มาทำ that logs
// the planned crew's labor through the EXISTING logLaborDays action (log_labor_day
// stays the source of truth; the board only pre-fills the tap targets). Workers
// already logged today show มาแล้ว. Renders nothing when there is no board for today.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logLaborDays } from "@/lib/labor/actions";
import { BUTTON_PRIMARY_COMPACT, BUTTON_SECONDARY_COMPACT, CARD } from "@/lib/ui/classes";

export type WorklistCrew = { workerId: string; name: string; present: boolean };
export type WorklistItem = {
  id: string;
  workPackageId: string;
  code: string;
  name: string;
  projectLabel?: string;
  crew: WorklistCrew[];
};

export function DailyPlanWorklist({
  dateIso,
  dateLabel,
  items,
}: {
  dateIso: string;
  dateLabel: string;
  items: WorklistItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (items.length === 0) return null;

  async function mark(workPackageId: string, workerIds: string[]) {
    if (workerIds.length === 0) return;
    setBusy(true);
    try {
      const r = await logLaborDays({
        workPackageId,
        revalidate: "/sa",
        workDate: dateIso,
        entries: workerIds.map((workerId) => ({ workerId, fraction: "full" as const })),
      });
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-meta text-ink-secondary font-semibold">แผนวันนี้</h2>
        <p className="text-meta text-ink-muted">{dateLabel}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((it) => {
          const pending = it.crew.filter((c) => !c.present).map((c) => c.workerId);
          return (
            <li
              key={it.id}
              data-testid={`worklist-item-${it.id}`}
              className={`${CARD} flex flex-col gap-2`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body text-ink min-w-40 flex-1 font-medium">
                  {it.code} {it.name}
                  {it.projectLabel ? (
                    <span className="text-meta text-ink-muted"> · {it.projectLabel}</span>
                  ) : null}
                </span>
                {pending.length > 0 ? (
                  <button
                    type="button"
                    className={`${BUTTON_SECONDARY_COMPACT} shrink-0`}
                    disabled={busy}
                    onClick={() => mark(it.workPackageId, pending)}
                  >
                    ทั้งหมดมาทำ
                  </button>
                ) : null}
              </div>
              <ul className="flex flex-col gap-1">
                {it.crew.map((c) => (
                  <li key={c.workerId} className="flex items-center gap-2">
                    <span className="text-body text-ink flex-1">{c.name}</span>
                    {c.present ? (
                      <span className="text-meta text-done-strong font-medium">มาแล้ว</span>
                    ) : (
                      <button
                        type="button"
                        className={`${BUTTON_PRIMARY_COMPACT} shrink-0`}
                        aria-label={`มาทำ ${c.name}`}
                        disabled={busy}
                        onClick={() => mark(it.workPackageId, [c.workerId])}
                      >
                        มาทำ
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
