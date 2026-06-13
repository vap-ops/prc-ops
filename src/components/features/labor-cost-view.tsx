// Spec 68 P2 — the PM-only labor cost view. Server Component: money is
// rendered server-side and never enters a field bundle. It ONLY mounts on
// the PM WP-detail page (requireRole pm/super); the SA page stays
// presence-only. Shows own/DC subtotals + grand total, the per-worker
// breakdown, cross-WP over-allocation flags (C5), and the frozen snapshot
// vs the live figure (with a re-freeze affordance when they drift, C6).

import { formatThaiDateTime } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";
import type { LaborCostSummary, OverAllocatedDay } from "@/lib/labor/cost";
import { RefreezeButton } from "@/components/features/refreeze-button";

interface FrozenSnapshot {
  ownCost: number;
  dcCost: number;
  computedAt: string;
  frozenByName: string;
}

interface LaborCostViewProps {
  summary: LaborCostSummary;
  frozen: FrozenSnapshot | null;
  overAllocated: OverAllocatedDay[];
  workPackageId: string;
  revalidate: string;
}

const WORKER_TYPE_LABEL = { own: "ทีมตัวเอง", dc: "ผู้รับเหมา" } as const;

function baht(n: number): string {
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function formatDays(days: number): string {
  // half-day granularity — show 1, 1.5, 0.5 etc.
  return days.toLocaleString("th-TH", { maximumFractionDigits: 1 });
}

export function LaborCostView({
  summary,
  frozen,
  overAllocated,
  workPackageId,
  revalidate,
}: LaborCostViewProps) {
  // Nothing logged and never frozen → the section renders nothing.
  if (summary.workers.length === 0 && !frozen) return null;

  const drift =
    frozen !== null &&
    (round2(frozen.ownCost) !== round2(summary.ownCost) ||
      round2(frozen.dcCost) !== round2(summary.dcCost));

  return (
    <div className={`${CARD} flex flex-col gap-4`}>
      {/* Live subtotals. */}
      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-zinc-600">ทีมตัวเอง</dt>
          <dd className="font-medium text-zinc-900">{baht(summary.ownCost)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-zinc-600">ผู้รับเหมา (DC)</dt>
          <dd className="font-medium text-zinc-900">{baht(summary.dcCost)}</dd>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-zinc-200 pt-2">
          <dt className="font-semibold text-zinc-900">รวมค่าแรง</dt>
          <dd className="text-base font-bold text-zinc-900">{baht(summary.total)}</dd>
        </div>
      </dl>

      {/* Frozen snapshot status + re-freeze. */}
      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3">
        {frozen ? (
          <>
            <p className="text-xs text-zinc-600">
              ตรึงค่าแรงไว้ {baht(round2(frozen.ownCost) + round2(frozen.dcCost))} · โดย{" "}
              {frozen.frozenByName} · {formatThaiDateTime(frozen.computedAt)}
            </p>
            {drift ? (
              <div className="flex flex-col items-start gap-1.5 rounded-lg border-l-4 border-amber-600 bg-amber-50 px-3 py-2">
                <p className="text-xs font-medium text-amber-900">
                  ค่าแรงเปลี่ยนไปตั้งแต่ตรึงล่าสุด — ตรึงใหม่เพื่อบันทึกยอดปัจจุบัน
                </p>
                <RefreezeButton
                  workPackageId={workPackageId}
                  revalidate={revalidate}
                  idleLabel="ตรึงค่าแรงใหม่"
                />
              </div>
            ) : (
              <p className="text-xs font-medium text-emerald-700">ตรงกับยอดปัจจุบัน</p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-start gap-1.5">
            <p className="text-xs text-zinc-600">ยังไม่ได้ตรึงค่าแรง</p>
            <RefreezeButton
              workPackageId={workPackageId}
              revalidate={revalidate}
              idleLabel="ตรึงค่าแรง"
            />
          </div>
        )}
      </div>

      {/* Per-worker breakdown. */}
      {summary.workers.length > 0 ? (
        <ul className="flex flex-col divide-y divide-zinc-100 border-t border-zinc-200 pt-1">
          {summary.workers.map((w) => (
            <li key={w.workerId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {w.name}
                  {w.selfLogged ? (
                    <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                      ลงเอง
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-zinc-600">
                  {WORKER_TYPE_LABEL[w.type]} · {formatDays(w.days)} วัน
                </p>
              </div>
              <span className="shrink-0 text-sm font-medium text-zinc-900">{baht(w.cost)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* C5: cross-WP over-allocation (>1.0 day on a date). Surfaced, never blocked. */}
      {overAllocated.length > 0 ? (
        <div className="border-t border-zinc-200 pt-3">
          <p className="mb-1.5 text-xs font-semibold text-amber-900">
            ลงแรงงานเกิน 1 วันต่อคนต่อวัน (รวมทุกงาน)
          </p>
          <ul className="flex flex-col gap-1">
            {overAllocated.map((o) => (
              <li key={`${o.workerId}|${o.workDate}`} className="text-xs text-zinc-600">
                {o.workDate} · {formatDays(o.totalDays)} วัน
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
