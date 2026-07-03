"use client";

// Spec 92 Unit D — the KANNA-style schedule calendar (Gantt). Reverse-engineered
// from the design-agent "Option E" preview, rebuilt on Field-First tokens:
//   • WP bars on a date timeline, grouped by งวดงาน (deliverable, amber header);
//   • sticky left name column; month bands + day ticks; gridlines; past shading;
//     dashed "วันนี้" today line;
//   • progress fill, status colour, urgent (ด่วน) chip, behind-schedule alert;
//   • critical-path bars get a red edge; finish-to-start dependency links are
//     dimmed hairlines that brighten when you tap a bar (highlights the chain);
//   • period switch วัน / สัปดาห์ / เดือน.
// Arrowheads use an SVG <marker orient="auto"> so they ALWAYS align with the
// curved connector (fixes the preview's fixed-orientation arrowhead).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { workPackageHref, scheduleHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { StatusPill } from "@/components/features/common/status-pill";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import { workPackageStatusIcon } from "@/lib/status-icons";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import {
  buildTimeline,
  barFor,
  scheduleSummary,
  SCHEDULE_PERIODS,
  type SchedulePeriod,
} from "@/lib/work-packages/gantt-scale";
import type { Database } from "@/lib/db/database.types";

type WorkPackageStatus = Database["public"]["Enums"]["work_package_status"];
type WpPriority = Database["public"]["Enums"]["work_package_priority"];

export interface GanttWp {
  id: string;
  code: string;
  name: string;
  status: WorkPackageStatus;
  deliverableId: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  priority: WpPriority;
  isCritical: boolean;
  /** Spec 255 — photo-evidence activity span (Bangkok ISO dates). */
  activityStart: string | null;
  activityEnd: string | null;
}
export interface GanttDeliverable {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
}
export interface GanttDependency {
  predecessorId: string;
  successorId: string;
}

interface ScheduleGanttProps {
  projectId: string;
  workPackages: GanttWp[];
  deliverables: GanttDeliverable[];
  dependencies: GanttDependency[];
  /** Server-supplied today (YYYY-MM-DD) so the line/shading are deterministic. */
  todayISO: string;
}

const NAME_W = 150;
const AXIS_H = 46;
const ROW_H = 48;
const GROUP_H = 34;
const BAR_H = 26;
const UNGROUPED = "__ungrouped__";

interface StatusStyle {
  border: string;
  bg: string;
  dot: string;
  fill: string;
  pct: number;
}
const STATUS_STYLE: Record<WorkPackageStatus, StatusStyle> = {
  not_started: {
    border: "border-edge-strong",
    bg: "bg-card",
    dot: "bg-ink-muted",
    fill: "bg-sunk",
    pct: 0,
  },
  in_progress: {
    border: "border-attn",
    bg: "bg-attn-soft",
    dot: "bg-attn",
    fill: "bg-attn/35",
    pct: 50,
  },
  pending_approval: {
    border: "border-wait",
    bg: "bg-wait-soft",
    dot: "bg-wait",
    fill: "bg-wait/30",
    pct: 90,
  },
  // Completed shows ALWAYS but MUTED (non-vivid): grey surface + a faint green
  // wash + a small green dot marks "done" without competing for attention
  // (operator 2026-06-14).
  complete: {
    border: "border-edge",
    bg: "bg-sunk",
    dot: "bg-done",
    fill: "bg-done/15",
    pct: 100,
  },
  on_hold: {
    border: "border-edge-strong",
    bg: "bg-sunk",
    dot: "bg-ink-muted",
    fill: "bg-ink-muted/20",
    pct: 25,
  },
  // Spec 144: complete WP reopened for a defect — attention (amber), most of the
  // work was done so the bar stays high.
  rework: {
    border: "border-attn",
    bg: "bg-attn-soft",
    dot: "bg-attn",
    fill: "bg-attn/35",
    pct: 90,
  },
};

type Row =
  | { kind: "group"; id: string; code: string; name: string; top: number }
  | { kind: "wp"; wp: GanttWp; top: number };

/** Spec 255 — a WP is "on the calendar" with a planned window OR photo activity. */
function hasData(wp: GanttWp): boolean {
  return (
    (wp.plannedStart !== null && wp.plannedEnd !== null) ||
    (wp.activityStart !== null && wp.activityEnd !== null)
  );
}

/** Transitive ancestors + descendants of a node over the dependency edges. */
function chainOf(
  selected: string | null,
  deps: GanttDependency[],
): { lit: Set<string> | null; direct: Set<string> } {
  if (!selected) return { lit: null, direct: new Set() };
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const d of deps) {
    (succs.get(d.predecessorId) ?? succs.set(d.predecessorId, []).get(d.predecessorId)!).push(
      d.successorId,
    );
    (preds.get(d.successorId) ?? preds.set(d.successorId, []).get(d.successorId)!).push(
      d.predecessorId,
    );
  }
  const lit = new Set<string>([selected]);
  const direct = new Set<string>([...(preds.get(selected) ?? []), ...(succs.get(selected) ?? [])]);
  const walk = (start: string, adj: Map<string, string[]>) => {
    const stack = [...(adj.get(start) ?? [])];
    while (stack.length) {
      const n = stack.pop() as string;
      if (lit.has(n)) continue;
      lit.add(n);
      stack.push(...(adj.get(n) ?? []));
    }
  };
  walk(selected, preds);
  walk(selected, succs);
  return { lit, direct };
}

export function ScheduleGantt({
  projectId,
  workPackages,
  deliverables,
  dependencies,
  todayISO,
}: ScheduleGanttProps) {
  const [period, setPeriod] = useState<SchedulePeriod>("week");
  const [selected, setSelected] = useState<string | null>(null);
  // Spec 255 — rows with neither a planned window nor photo activity collapse
  // behind a count toggle (they used to drown the real bars).
  const [showNoData, setShowNoData] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const noDataCount = useMemo(() => workPackages.filter((w) => !hasData(w)).length, [workPackages]);
  const visibleWps = useMemo(
    () => (showNoData ? workPackages : workPackages.filter(hasData)),
    [workPackages, showNoData],
  );

  // Always show ALL WPs; completed ones render muted (non-vivid) rather than
  // being hidden (operator decision 2026-06-14). The domain covers every WP's
  // dates (planned + activity) so toggling no-data rows never reflows the axis.
  const timeline = useMemo(
    () => buildTimeline(workPackages, period, todayISO),
    [workPackages, period, todayISO],
  );

  // Ordered rows: each deliverable (sortOrder) with its WPs, ungrouped last.
  const { rows, totalH } = useMemo(() => {
    const byDeliv = new Map<string, GanttWp[]>();
    for (const wp of visibleWps) {
      const k = wp.deliverableId ?? UNGROUPED;
      const list = byDeliv.get(k) ?? byDeliv.set(k, []).get(k)!;
      list.push(wp);
    }
    const ordered = [...deliverables].sort((a, b) => a.sortOrder - b.sortOrder);
    const out: Row[] = [];
    let top = 0;
    const pushGroup = (id: string, code: string, name: string, items: GanttWp[]) => {
      out.push({ kind: "group", id, code, name, top });
      top += GROUP_H;
      for (const wp of items) {
        out.push({ kind: "wp", wp, top });
        top += ROW_H;
      }
    };
    for (const d of ordered) {
      const items = byDeliv.get(d.id);
      if (items?.length) pushGroup(d.id, d.code, d.name, items);
    }
    const ung = byDeliv.get(UNGROUPED);
    if (ung?.length) pushGroup(UNGROUPED, "", "ยังไม่จัดกลุ่ม", ung);
    return { rows: out, totalH: top };
  }, [visibleWps, deliverables]);

  // Bar geometry per scheduled WP (+ its row centre, for dependency lines).
  const geom = useMemo(() => {
    const m = new Map<string, { x: number; width: number; cy: number }>();
    for (const r of rows) {
      if (r.kind !== "wp") continue;
      const bar = barFor(r.wp, timeline.domainStartMs, timeline.dayWidth);
      if (bar) m.set(r.wp.id, { x: bar.x, width: bar.width, cy: r.top + ROW_H / 2 });
    }
    return m;
  }, [rows, timeline]);

  // Spec 255 — activity-strip geometry (photo-evidence span), same x math as
  // the planned bars via barFor over the activity window.
  const activityGeom = useMemo(() => {
    const m = new Map<string, { x: number; width: number }>();
    for (const r of rows) {
      if (r.kind !== "wp") continue;
      const bar = barFor(
        { plannedStart: r.wp.activityStart, plannedEnd: r.wp.activityEnd },
        timeline.domainStartMs,
        timeline.dayWidth,
      );
      if (bar) m.set(r.wp.id, bar);
    }
    return m;
  }, [rows, timeline]);

  const { lit, direct } = useMemo(() => chainOf(selected, dependencies), [selected, dependencies]);
  const todayMs = useMemo(() => Date.parse(`${todayISO}T00:00:00Z`), [todayISO]);
  const hasAnyData = useMemo(() => workPackages.some(hasData), [workPackages]);
  const summary = useMemo(
    () =>
      scheduleSummary(
        workPackages.map((w) => ({
          plannedEnd: w.plannedEnd,
          status: w.status,
          activityEnd: w.activityEnd,
        })),
        todayISO,
      ),
    [workPackages, todayISO],
  );
  const selectedWp = selected ? (workPackages.find((w) => w.id === selected) ?? null) : null;

  // Spec 255 — open the viewport at today (~⅓ in), not at the earliest month.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || timeline.todayX === null) return;
    el.scrollLeft = Math.max(0, timeline.todayX - Math.max(0, el.clientWidth - NAME_W) / 3);
  }, [timeline]);

  const periodBtn = (on: boolean) =>
    `text-meta focus-visible:ring-action min-h-11 rounded-[0.625rem] px-3 font-bold transition-colors focus:outline-none focus-visible:ring-2 ${
      on ? "bg-card text-ink shadow-card" : "text-ink-secondary hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-3">
      {/* Period zoom — วัน / สัปดาห์ / เดือน */}
      <div
        role="radiogroup"
        aria-label="ช่วงเวลา"
        className="border-edge bg-sunk rounded-control flex w-fit gap-1 self-end border p-1"
      >
        {SCHEDULE_PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={period === p.key}
            onClick={() => setPeriod(p.key)}
            className={periodBtn(period === p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {!hasAnyData ? (
        <div className="border-edge bg-card text-ink-secondary rounded-card text-body border p-8 text-center">
          ยังไม่มีข้อมูลบนปฏิทิน — ถ่ายรูปงานแล้วปฏิทินจะแสดงช่วงงานจริงให้อัตโนมัติ
          หรือตั้งวันเริ่ม/สิ้นสุดในหน้ารายละเอียดงาน (เฉพาะผู้จัดการ)
        </div>
      ) : (
        <>
          {/* Spec 255 — summary chips (zero counts hide) */}
          {(summary.behind > 0 || summary.dueSoon > 0 || summary.recentActivity > 0) && (
            <div className="text-meta flex flex-wrap items-center gap-2">
              {summary.behind > 0 && (
                <span className="border-danger/40 bg-danger/10 text-danger rounded-full border px-2.5 py-1 font-bold">
                  ช้ากว่าแผน {summary.behind}
                </span>
              )}
              {summary.dueSoon > 0 && (
                <span className="border-attn bg-attn-soft text-ink rounded-full border px-2.5 py-1 font-bold">
                  ครบกำหนดใน 7 วัน {summary.dueSoon}
                </span>
              )}
              {summary.recentActivity > 0 && (
                <span className="border-edge bg-done/10 text-ink rounded-full border px-2.5 py-1 font-bold">
                  มีงานจริง 7 วันล่าสุด {summary.recentActivity}
                </span>
              )}
            </div>
          )}

          {/* Gantt scroll container */}
          <div
            ref={scrollRef}
            data-testid="gantt-scroll"
            className="border-edge bg-card rounded-card relative overflow-auto border"
            style={{ maxHeight: 560 }}
          >
            <div style={{ width: NAME_W + timeline.widthPx, minWidth: "100%" }}>
              {/* Axis row (sticky top) */}
              <div
                className="border-edge-strong sticky top-0 z-20 flex border-b"
                style={{ height: AXIS_H }}
              >
                <div
                  className="border-edge bg-card text-meta text-ink-secondary sticky left-0 z-30 flex items-end border-r px-3 pb-1.5 font-semibold"
                  style={{ width: NAME_W }}
                >
                  งาน
                </div>
                <div className="bg-card relative" style={{ width: timeline.widthPx }}>
                  {timeline.months.map((mb, i) => (
                    <div
                      key={i}
                      className="border-edge text-ink-secondary text-meta absolute top-0 flex h-full items-start border-l pt-1 pl-1.5 font-semibold"
                      style={{ left: mb.x, width: mb.width }}
                    >
                      {mb.label}
                    </div>
                  ))}
                  {timeline.days.map((d, i) => (
                    <div
                      key={i}
                      className={`text-ink-muted absolute bottom-0 flex h-4 items-center justify-center text-[9px] ${
                        d.isWeekend ? "opacity-60" : ""
                      }`}
                      style={{ left: d.x, width: timeline.dayWidth }}
                    >
                      {d.day}
                    </div>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="relative" style={{ height: totalH }}>
                {/* Grid + past shade + today line live over the timeline area only */}
                <div
                  className="pointer-events-none absolute top-0 z-0"
                  style={{ left: NAME_W, width: timeline.widthPx, height: totalH }}
                >
                  {timeline.pastWidth > 0 && (
                    <div
                      className="bg-ink/5 absolute top-0 h-full"
                      style={{ left: 0, width: timeline.pastWidth }}
                    />
                  )}
                  {timeline.months.map((mb, i) => (
                    <div
                      key={i}
                      className="border-edge absolute top-0 h-full border-l"
                      style={{ left: mb.x }}
                    />
                  ))}
                  {timeline.todayX !== null && (
                    <div
                      className="bg-danger absolute top-0 z-[1] h-full"
                      style={{ left: timeline.todayX, width: 2, opacity: 0.55 }}
                    />
                  )}
                </div>

                {/* Dependency layer (SVG) — over the timeline area */}
                <svg
                  className="pointer-events-none absolute top-0 z-[2]"
                  style={{
                    left: NAME_W,
                    width: timeline.widthPx,
                    height: totalH,
                    overflow: "visible",
                  }}
                  width={timeline.widthPx}
                  height={totalH}
                >
                  <defs>
                    <marker
                      id="ah-grey"
                      markerWidth="8"
                      markerHeight="8"
                      refX="6.5"
                      refY="3"
                      orient="auto"
                      markerUnits="userSpaceOnUse"
                    >
                      <path d="M0,0 L7,3 L0,6 Z" className="fill-ink-muted" />
                    </marker>
                    <marker
                      id="ah-crit"
                      markerWidth="9"
                      markerHeight="9"
                      refX="7"
                      refY="3.2"
                      orient="auto"
                      markerUnits="userSpaceOnUse"
                    >
                      <path d="M0,0 L7.5,3.2 L0,6.4 Z" className="fill-danger" />
                    </marker>
                  </defs>
                  {dependencies.map((dep, i) => {
                    const a = geom.get(dep.predecessorId);
                    const b = geom.get(dep.successorId);
                    if (!a || !b) return null;
                    const sx = a.x + a.width;
                    const sy = a.cy;
                    const ex = b.x;
                    const ey = b.cy;
                    const dx = Math.max(14, Math.abs(ex - sx) / 2);
                    const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`;
                    const crit =
                      workPackages.find((w) => w.id === dep.predecessorId)?.isCritical &&
                      workPackages.find((w) => w.id === dep.successorId)?.isCritical;
                    const isLit =
                      lit !== null && lit.has(dep.predecessorId) && lit.has(dep.successorId);
                    const dimmed = lit !== null && !isLit;
                    return (
                      <path
                        key={i}
                        d={d}
                        fill="none"
                        className={crit ? "stroke-danger" : "stroke-ink-muted"}
                        strokeWidth={isLit ? 2.4 : 1.4}
                        markerEnd={`url(#${crit ? "ah-crit" : "ah-grey"})`}
                        opacity={dimmed ? 0.18 : isLit ? 1 : crit ? 0.55 : 0.4}
                      />
                    );
                  })}
                </svg>

                {/* Rows */}
                {rows.map((r) => {
                  if (r.kind === "group") {
                    return (
                      <div
                        key={`g-${r.id}`}
                        className="absolute flex w-full"
                        style={{ top: r.top, height: GROUP_H }}
                      >
                        <div
                          className="border-edge border-attn bg-attn-soft/40 sticky left-0 z-10 flex items-center gap-2 border-r border-l-4 px-3"
                          style={{ width: NAME_W }}
                        >
                          {r.code && (
                            <span className="text-ink-secondary font-mono text-[10.5px] font-semibold">
                              {r.code}
                            </span>
                          )}
                          <span className="text-ink text-meta truncate font-bold">{r.name}</span>
                        </div>
                        <div className="bg-sunk/40 border-edge-strong flex-1 border-b" />
                      </div>
                    );
                  }
                  const wp = r.wp;
                  const g = geom.get(wp.id);
                  const a = activityGeom.get(wp.id);
                  const st = STATUS_STYLE[wp.status];
                  const behind =
                    !Number.isNaN(todayMs) &&
                    wp.plannedEnd !== null &&
                    wp.status !== "complete" &&
                    Date.parse(`${wp.plannedEnd}T00:00:00Z`) < todayMs;
                  const isSel = selected === wp.id;
                  const isDirect = direct.has(wp.id);
                  const isDim = lit !== null && !lit.has(wp.id);
                  return (
                    <div
                      key={wp.id}
                      className="group absolute flex w-full"
                      style={{ top: r.top, height: ROW_H }}
                    >
                      <div
                        className="border-edge border-edge-strong bg-card group-hover:bg-sunk sticky left-0 z-10 flex flex-col justify-center border-r border-b px-3 py-1"
                        style={{ width: NAME_W }}
                      >
                        <span className="text-ink-secondary font-mono text-[10.5px]">
                          {wp.code}
                        </span>
                        <span className="text-ink line-clamp-2 text-[12.5px] leading-tight font-semibold">
                          {wp.name}
                        </span>
                      </div>
                      <div className="border-edge-strong group-hover:bg-sunk/50 relative flex-1 border-b">
                        {g ? (
                          <button
                            type="button"
                            onClick={() => setSelected(isSel ? null : wp.id)}
                            aria-label={`${wp.code} ${wp.name}`}
                            className={`absolute flex items-center gap-1.5 overflow-hidden rounded-[9px] border-[1.5px] ${st.border} ${st.bg} shadow-card px-1.5 transition-opacity ${
                              isDim ? "opacity-25" : "opacity-100"
                            } ${isSel ? "ring-fill ring-2" : isDirect ? "ring-attn ring-2" : ""}`}
                            style={{
                              left: g.x,
                              width: Math.max(g.width, 22),
                              top: (ROW_H - BAR_H) / 2,
                              height: BAR_H,
                            }}
                          >
                            {/* progress fill */}
                            {st.pct > 0 && (
                              <span
                                className={`pointer-events-none absolute top-0 bottom-0 left-0 rounded-l-[7px] ${st.fill}`}
                                style={{ width: `${st.pct}%` }}
                              />
                            )}
                            {/* critical red edge */}
                            {wp.isCritical && (
                              <span className="bg-danger pointer-events-none absolute top-0 bottom-0 left-0 w-1" />
                            )}
                            <span
                              className={`relative z-[1] h-[7px] w-[7px] shrink-0 rounded-full ${st.dot}`}
                              aria-hidden
                            />
                            <span className="text-ink relative z-[1] truncate text-[11px] font-semibold">
                              {wp.name}
                            </span>
                            {(wp.priority === "urgent" || wp.priority === "critical") && (
                              <span className="bg-attn text-on-attn relative z-[1] shrink-0 rounded px-1 text-[9px] font-extrabold">
                                ด่วน
                              </span>
                            )}
                            {behind && (
                              <span
                                className="text-danger relative z-[1] shrink-0 text-[10px] font-extrabold"
                                aria-label="ช้ากว่าแผน"
                              >
                                ●
                              </span>
                            )}
                          </button>
                        ) : a ? null : (
                          <span className="text-ink-muted absolute top-1/2 left-2 -translate-y-1/2 text-[10px]">
                            ยังไม่กำหนดวันที่
                          </span>
                        )}
                        {/* Spec 255 — photo-evidence activity strip: under the
                        planned bar when one exists, alone (centred) otherwise. */}
                        {a && (
                          <span
                            aria-label={`ช่วงงานจริง ${wp.code}`}
                            className={`bg-done/70 pointer-events-none absolute rounded-full transition-opacity ${
                              isDim ? "opacity-25" : "opacity-100"
                            }`}
                            style={{
                              left: a.x,
                              width: Math.max(a.width, 6),
                              top: g ? (ROW_H - BAR_H) / 2 + BAR_H + 2 : (ROW_H - 6) / 2,
                              height: 6,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Selected WP — identity + status + open + clear. Sits right under the
          calendar so the open action is co-located + thumb-reachable (replaces
          the easy-to-miss link). Tap still highlights the dependency chain. */}
          {selectedWp && (
            <div className="border-edge bg-card shadow-card rounded-card flex items-center gap-2.5 border px-3 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-ink-secondary text-meta font-mono">{selectedWp.code}</span>
                <span className="text-ink text-body line-clamp-1 font-semibold">
                  {selectedWp.name}
                </span>
              </span>
              <StatusPill
                pillClasses={workPackageStatusPillClasses(selectedWp.status)}
                icon={workPackageStatusIcon(selectedWp.status)}
              >
                {WORK_PACKAGE_STATUS_LABEL[selectedWp.status] ?? selectedWp.status}
              </StatusPill>
              <Link
                href={withBackFrom(
                  workPackageHref(projectId, selectedWp.id),
                  scheduleHref(projectId),
                )}
                className="rounded-control bg-fill text-on-fill hover:bg-fill-press focus-visible:ring-action text-meta inline-flex h-11 shrink-0 items-center gap-1 px-3 font-semibold transition-colors focus:outline-none focus-visible:ring-2"
              >
                เปิดรายละเอียด <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="ล้างการเลือก"
                className="rounded-control text-ink-muted hover:text-ink hover:bg-sunk focus-visible:ring-action inline-flex h-11 w-11 shrink-0 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2"
              >
                <X aria-hidden className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* Spec 255 — no-data rows collapse behind a count toggle */}
          {noDataCount > 0 && (
            <button
              type="button"
              onClick={() => setShowNoData((v) => !v)}
              className="border-edge bg-card text-ink-secondary hover:text-ink hover:bg-sunk focus-visible:ring-action rounded-control text-meta inline-flex min-h-11 w-fit items-center border px-3 font-semibold transition-colors focus:outline-none focus-visible:ring-2"
            >
              {showNoData
                ? `ซ่อนงานที่ยังไม่มีข้อมูล (${noDataCount})`
                : `แสดงงานที่ยังไม่มีข้อมูล (${noDataCount})`}
            </button>
          )}

          {/* Legend + tap hint */}
          <div className="text-ink-secondary text-meta flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className="bg-done/70 inline-block h-1.5 w-4 rounded-full" /> ช่วงที่มีงานจริง
              (จากรูปถ่าย)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-danger inline-block h-2.5 w-1 rounded" /> เส้นทางวิกฤต
            </span>
            <span className="flex items-center gap-1.5">
              <span className="bg-attn inline-block h-2.5 w-2.5 rounded-full" /> ด่วน
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-danger font-extrabold">●</span> ช้ากว่าแผน
            </span>
            <span className="text-ink-muted">แตะแถบเพื่อดูสายงาน แล้วเปิดรายละเอียด</span>
          </div>
        </>
      )}
    </div>
  );
}
