// Spec 68 P2 — the PM-only labor cost view. Server Component: money is
// rendered server-side and never enters a field bundle. It ONLY mounts on
// the PM WP-detail page (requireRole pm/super); the SA page stays
// presence-only. Shows own/DC subtotals + grand total, the per-worker
// breakdown, cross-WP over-allocation flags (C5), and the frozen snapshot
// vs the live figure (with a re-freeze affordance when they drift, C6).

import { formatThaiDateTime } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";
import type { LaborCostSummary, OverAllocatedDay } from "@/lib/labor/cost";
import { RefreezeButton } from "@/components/features/labor/refreeze-button";
import { bahtUnit as baht, round2 } from "@/lib/format";

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

// ADR 0062 merge: dc is now a DAILY-paid ช่าง, not a "ผู้รับเหมา" (contractor) —
// neutral labels keyed by pay_type, matching the schema's own/dc→monthly/daily
// collapse (LOGIC MAP).
const PAY_TYPE_LABEL = { monthly: "รายเดือน", daily: "รายวัน" } as const;

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
          <dt className="text-ink-secondary">ทีมตัวเอง</dt>
          <dd className="text-ink font-medium">{baht(summary.ownCost)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-secondary">ผู้รับเหมา (DC)</dt>
          <dd className="text-ink font-medium">{baht(summary.dcCost)}</dd>
        </div>
        <div className="border-edge mt-1 flex items-center justify-between gap-3 border-t pt-2">
          <dt className="text-ink font-semibold">รวมค่าแรง</dt>
          <dd className="text-ink text-base font-bold">{baht(summary.total)}</dd>
        </div>
      </dl>

      {/* Frozen snapshot status + re-freeze. */}
      <div className="border-edge flex flex-col gap-2 border-t pt-3">
        {frozen ? (
          <>
            <p className="text-ink-secondary text-xs">
              ตรึงค่าแรงไว้ {baht(round2(frozen.ownCost) + round2(frozen.dcCost))} · โดย{" "}
              {frozen.frozenByName} · {formatThaiDateTime(frozen.computedAt)}
            </p>
            {drift ? (
              <div className="rounded-control border-attn bg-attn-soft flex flex-col items-start gap-1.5 border-l-4 px-3 py-2">
                <p className="text-attn-ink text-xs font-medium">
                  ค่าแรงเปลี่ยนไปตั้งแต่ตรึงล่าสุด — ตรึงใหม่เพื่อบันทึกยอดปัจจุบัน
                </p>
                <RefreezeButton
                  workPackageId={workPackageId}
                  revalidate={revalidate}
                  idleLabel="ตรึงค่าแรงใหม่"
                />
              </div>
            ) : (
              <p className="text-done-strong text-xs font-medium">ตรงกับยอดปัจจุบัน</p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-start gap-1.5">
            <p className="text-ink-secondary text-xs">ยังไม่ได้ตรึงค่าแรง</p>
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
        <ul className="divide-edge border-edge flex flex-col divide-y border-t pt-1">
          {summary.workers.map((w) => (
            <li key={w.workerId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-ink truncate text-sm font-medium">
                  {w.name}
                  {w.selfLogged ? (
                    <span className="bg-sunk text-ink-secondary ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium">
                      ลงเอง
                    </span>
                  ) : null}
                </p>
                <p className="text-ink-secondary text-xs">
                  {PAY_TYPE_LABEL[w.type]} · {formatDays(w.days)} วัน
                </p>
              </div>
              <span className="text-ink shrink-0 text-sm font-medium">{baht(w.cost)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* C5: cross-WP over-allocation (>1.0 day on a date). Surfaced, never blocked. */}
      {overAllocated.length > 0 ? (
        <div className="border-edge border-t pt-3">
          <p className="text-attn-ink mb-1.5 text-xs font-semibold">
            ลงเกิน 1 วันต่อคนต่อวัน (รวมทุกงาน)
          </p>
          <ul className="flex flex-col gap-1">
            {overAllocated.map((o) => (
              <li key={`${o.workerId}|${o.workDate}`} className="text-ink-secondary text-xs">
                {o.workDate} · {formatDays(o.totalDays)} วัน
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
