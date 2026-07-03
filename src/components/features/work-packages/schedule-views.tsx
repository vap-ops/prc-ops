"use client";

// Spec 256 U2 — the schedule page's view container: เดือน | สัปดาห์ | วัน |
// ไทม์ไลน์. The first three are real calendar views over the photo-evidence
// data (per-day activity) + planned dates; ไทม์ไลน์ hosts the spec-92/255
// Gantt unchanged. One selected date drives month anchor, week and day; tap a
// month day → drill into the วัน view for that date.

import { useMemo, useState } from "react";
import {
  ScheduleGantt,
  type GanttWp,
  type GanttDeliverable,
  type GanttDependency,
} from "@/components/features/work-packages/schedule-gantt";
import { ScheduleMonthView } from "@/components/features/work-packages/schedule-month-view";
import {
  ScheduleDayView,
  ScheduleWeekView,
  type DayEntries,
} from "@/components/features/work-packages/schedule-agenda";
import { addDaysIso, addMonthsIso } from "@/lib/work-packages/calendar-grid";

type ScheduleView = "month" | "week" | "day" | "timeline";

const VIEWS: ReadonlyArray<{ key: ScheduleView; label: string }> = [
  { key: "month", label: "เดือน" },
  { key: "week", label: "สัปดาห์" },
  { key: "day", label: "วัน" },
  { key: "timeline", label: "ไทม์ไลน์" },
];

interface ScheduleViewsProps {
  projectId: string;
  todayISO: string;
  workPackages: GanttWp[];
  deliverables: GanttDeliverable[];
  dependencies: GanttDependency[];
  /** iso day → wpId → photo count (plain object across the RSC boundary). */
  activityDays: Record<string, Record<string, number>>;
}

export function ScheduleViews({
  projectId,
  todayISO,
  workPackages,
  deliverables,
  dependencies,
  activityDays,
}: ScheduleViewsProps) {
  const [view, setView] = useState<ScheduleView>("month");
  const [selectedIso, setSelectedIso] = useState(todayISO);

  const wpById = useMemo(() => new Map(workPackages.map((w) => [w.id, w])), [workPackages]);

  const { dueByDay, startByDay } = useMemo(() => {
    const due = new Map<string, GanttWp[]>();
    const start = new Map<string, GanttWp[]>();
    for (const wp of workPackages) {
      if (wp.plannedEnd)
        (due.get(wp.plannedEnd) ?? due.set(wp.plannedEnd, []).get(wp.plannedEnd)!).push(wp);
      if (wp.plannedStart)
        (start.get(wp.plannedStart) ?? start.set(wp.plannedStart, []).get(wp.plannedStart)!).push(
          wp,
        );
    }
    return { dueByDay: due, startByDay: start };
  }, [workPackages]);

  const { activityCountByDay, dueCountByDay } = useMemo(() => {
    const activity: Record<string, number> = {};
    for (const [iso, perWp] of Object.entries(activityDays)) {
      activity[iso] = Object.keys(perWp).length;
    }
    const dueCounts: Record<string, number> = {};
    for (const [iso, wps] of dueByDay) dueCounts[iso] = wps.length;
    return { activityCountByDay: activity, dueCountByDay: dueCounts };
  }, [activityDays, dueByDay]);

  const entriesFor = (iso: string): DayEntries => {
    const active = Object.entries(activityDays[iso] ?? {})
      .map(([wpId, photoCount]) => {
        const wp = wpById.get(wpId);
        return wp ? { wp, photoCount } : null;
      })
      .filter((e): e is { wp: GanttWp; photoCount: number } => e !== null)
      .sort((a, b) => a.wp.code.localeCompare(b.wp.code));
    return {
      active,
      due: dueByDay.get(iso) ?? [],
      starting: startByDay.get(iso) ?? [],
    };
  };

  const viewBtn = (on: boolean) =>
    `text-meta focus-visible:ring-action min-h-11 rounded-[0.625rem] px-3 font-bold transition-colors focus:outline-none focus-visible:ring-2 ${
      on ? "bg-card text-ink shadow-card" : "text-ink-secondary hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-3">
      {/* View switch — เดือน / สัปดาห์ / วัน / ไทม์ไลน์ */}
      <div
        role="radiogroup"
        aria-label="มุมมอง"
        className="border-edge bg-sunk rounded-control flex w-fit gap-1 self-start border p-1"
      >
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="radio"
            aria-checked={view === v.key}
            onClick={() => setView(v.key)}
            className={viewBtn(view === v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "month" && (
        <ScheduleMonthView
          anchorIso={selectedIso}
          todayISO={todayISO}
          activityCountByDay={activityCountByDay}
          dueCountByDay={dueCountByDay}
          onDayTap={(iso) => {
            setSelectedIso(iso);
            setView("day");
          }}
          onPrevMonth={() => setSelectedIso(addMonthsIso(selectedIso, -1))}
          onNextMonth={() => setSelectedIso(addMonthsIso(selectedIso, 1))}
          onToday={() => setSelectedIso(todayISO)}
        />
      )}

      {view === "week" && (
        <ScheduleWeekView
          projectId={projectId}
          anchorIso={selectedIso}
          todayISO={todayISO}
          entriesFor={entriesFor}
          onPrev={() => setSelectedIso(addDaysIso(selectedIso, -7))}
          onNext={() => setSelectedIso(addDaysIso(selectedIso, 7))}
          onToday={() => setSelectedIso(todayISO)}
        />
      )}

      {view === "day" && (
        <ScheduleDayView
          projectId={projectId}
          iso={selectedIso}
          todayISO={todayISO}
          entries={entriesFor(selectedIso)}
          onPrev={() => setSelectedIso(addDaysIso(selectedIso, -1))}
          onNext={() => setSelectedIso(addDaysIso(selectedIso, 1))}
          onToday={() => setSelectedIso(todayISO)}
        />
      )}

      {view === "timeline" && (
        <ScheduleGantt
          projectId={projectId}
          todayISO={todayISO}
          workPackages={workPackages}
          deliverables={deliverables}
          dependencies={dependencies}
        />
      )}
    </div>
  );
}
