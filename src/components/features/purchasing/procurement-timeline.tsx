"use client";

// Spec 327 U4 — the procurement timeline renderer. 'use client' justification:
// the zoom pills (SCHEDULE_PERIODS ใกล้/กลาง/ไกล) are local interaction state —
// re-deriving the pure projection per zoom without a navigation (the
// ScheduleGantt precedent). Thin by design: flat vertical WP rows (NO
// deliverable grouping), sticky name column, pins presentational in v1 (no
// sub-44px tap targets — the เสี่ยงช้า LIST is the actionable surface).
//
// ⚠ Scroll container: overflow-x-auto + [touch-action:manipulation] — NOT
// ScheduleGantt's overflow-auto (dodges the ui-class-contracts guard) and NOT
// the row-strip pan-x_pinch-zoom pair: this surface is hundreds of lanes TALL,
// and pan-x-only would dead-zone vertical page scrolling across most of the
// viewport (a §0.1-in-effect drop on mobile). `manipulation` = pan-x + pan-y +
// pinch-zoom — it ENABLES the horizontal pan the 14263ad8 bug class was about
// while letting vertical touches scroll the page; the guard checker was
// extended (same PR) to accept it as compliant.

import { useMemo, useState } from "react";

import { formatThaiDate, NO_ETA_LABEL, TIMELINE_LABEL, UNDATED_WP_LABEL } from "@/lib/i18n/labels";
import {
  buildProcurementTimeline,
  type TimelinePin,
  type TimelineWpInput,
} from "@/lib/purchasing/procurement-timeline";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import type { TimePrRow } from "@/lib/purchasing/time-view";
import { SCHEDULE_PERIODS, type SchedulePeriod } from "@/lib/work-packages/gantt-scale";

const NAME_W = 128;
const ROW_H = 36;

function PinDot({ pin }: { pin: TimelinePin }) {
  return (
    <span
      aria-hidden
      title={`${formatPrNumber(pin.prNumber)} ถึง ${formatThaiDate(pin.eta)}`}
      className={`absolute size-2.5 rounded-full border-2 ${
        pin.late ? "bg-danger border-danger" : "bg-action border-action"
      }`}
      style={{ left: NAME_W + pin.x, top: ROW_H / 2 - 5 }}
    />
  );
}

export function ProcurementTimeline({
  wps,
  prRows,
  todayIso,
}: {
  wps: ReadonlyArray<TimelineWpInput>;
  prRows: ReadonlyArray<TimePrRow>;
  todayIso: string;
}) {
  const [period, setPeriod] = useState<SchedulePeriod>("week");
  const model = useMemo(
    () => buildProcurementTimeline(wps, prRows, period, todayIso),
    [wps, prRows, period, todayIso],
  );
  const { timeline, storeLane, lanes, undatedWps, noEtaPrs } = model;
  const hasStoreLane = storeLane.length > 0;
  const laneCount = lanes.length + (hasStoreLane ? 1 : 0);
  const bodyH = laneCount * ROW_H;

  return (
    <div className="flex flex-col gap-3">
      {/* Zoom — SCHEDULE_PERIODS verbatim (spec-92 honest-zoom labels). */}
      <div className="flex items-center gap-2" role="group" aria-label={`ซูม${TIMELINE_LABEL}`}>
        {SCHEDULE_PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            aria-pressed={period === p.key}
            className={`text-meta inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
              period === p.key
                ? "bg-fill text-on-fill border-fill"
                : "border-edge bg-card text-ink-secondary hover:bg-sunk"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {laneCount === 0 ? null : (
        <div
          data-testid="procurement-timeline-scroll"
          className="border-edge bg-card rounded-card relative [touch-action:manipulation] overflow-x-auto border"
        >
          <div style={{ width: NAME_W + timeline.widthPx, minWidth: "100%" }}>
            {/* Month axis */}
            <div className="border-edge relative h-6 border-b" style={{ marginLeft: NAME_W }}>
              {timeline.months.map((m) => (
                <span
                  key={m.label + m.x}
                  className="text-ink-secondary absolute top-1 text-[10px] font-semibold"
                  style={{ left: m.x + 4 }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            <div className="relative" style={{ height: bodyH }}>
              {/* today line */}
              {timeline.todayX !== null ? (
                <span
                  aria-hidden
                  className="bg-action absolute top-0 bottom-0 w-px opacity-60"
                  style={{ left: NAME_W + timeline.todayX }}
                />
              ) : null}

              {/* คลัง lane (anchorless pins) on top */}
              {hasStoreLane ? (
                <div
                  className="border-edge absolute right-0 left-0 border-b"
                  style={{ top: 0, height: ROW_H }}
                >
                  <span
                    className="bg-sunk text-ink-secondary sticky left-0 z-10 inline-flex h-full items-center truncate px-2 text-xs font-semibold"
                    style={{ width: NAME_W }}
                  >
                    คลัง · ระดับโครงการ
                  </span>
                  {storeLane.map((pin) => (
                    <PinDot key={pin.id} pin={pin} />
                  ))}
                </div>
              ) : null}

              {lanes.map((lane, i) => {
                const y = (hasStoreLane ? i + 1 : i) * ROW_H;
                return (
                  <div
                    key={lane.wp.id}
                    className="border-edge absolute right-0 left-0 border-b"
                    style={{ top: y, height: ROW_H }}
                  >
                    <span
                      className="bg-card text-ink sticky left-0 z-10 inline-flex h-full items-center gap-1 truncate px-2 text-xs font-semibold"
                      style={{ width: NAME_W }}
                    >
                      <span className="text-ink-muted font-mono">{lane.wp.code}</span>
                      <span className="min-w-0 truncate">{lane.wp.name}</span>
                    </span>
                    {lane.bar ? (
                      <span
                        aria-hidden
                        className="bg-action/30 border-action/50 absolute rounded-sm border"
                        style={{
                          left: NAME_W + lane.bar.x,
                          width: lane.bar.width,
                          top: 8,
                          height: ROW_H - 16,
                        }}
                      />
                    ) : null}
                    {lane.pins.map((pin) => (
                      <PinDot key={pin.id} pin={pin} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Shelves — §0.1 labeled buckets for what the axis can't place. */}
      {undatedWps.length > 0 ? (
        <details className="rounded-card border-edge bg-card border px-4 py-3">
          <summary className="text-body text-ink-secondary min-h-11 cursor-pointer font-semibold">
            {UNDATED_WP_LABEL} ({undatedWps.length})
          </summary>
          <ul className="text-meta text-ink-secondary mt-2 flex flex-col gap-1">
            {undatedWps.map((w) => (
              <li key={w.id} className="truncate">
                <span className="text-ink-muted mr-1.5 font-mono">{w.code}</span>
                {w.name}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {noEtaPrs.length > 0 ? (
        <details className="rounded-card border-edge bg-card border px-4 py-3">
          <summary className="text-body text-ink-secondary min-h-11 cursor-pointer font-semibold">
            {NO_ETA_LABEL} ({noEtaPrs.length})
          </summary>
          <ul className="text-meta text-ink-secondary mt-2 flex flex-col gap-1">
            {noEtaPrs.map((r) => (
              <li key={r.id} className="truncate">
                <span className="text-ink-muted mr-1.5 font-mono">
                  {formatPrNumber(r.prNumber)}
                </span>
                {r.itemDescription}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
