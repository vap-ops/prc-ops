"use client";

// Spec 256 U2 — true Thai month grid (Sunday-first, BE header). Day cells are
// tap targets that drill into the วัน view; each shows photo-activity count
// (WPs with photos that day) and a due marker (planned_end that day). Data
// arrives pre-bucketed from the container — this component only lays out.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthGrid, THAI_WEEKDAYS } from "@/lib/work-packages/calendar-grid";
import { THAI_MONTHS } from "@/lib/work-packages/gantt-scale";

interface ScheduleMonthViewProps {
  anchorIso: string;
  todayISO: string;
  /** iso day → number of WPs with photos that day. */
  activityCountByDay: Record<string, number>;
  /** iso day → number of WPs whose planned_end is that day. */
  dueCountByDay: Record<string, number>;
  onDayTap: (iso: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
}

function cellAriaLabel(iso: string, day: number, active: number, due: number): string {
  const month = THAI_MONTHS[Number(iso.slice(5, 7)) - 1];
  let label = `${day} ${month}`;
  if (active > 0) label += ` งานจริง ${active}`;
  if (due > 0) label += ` ครบกำหนด ${due}`;
  return label;
}

const NAV_BTN =
  "rounded-control text-ink-secondary hover:text-ink hover:bg-sunk focus-visible:ring-action inline-flex h-11 w-11 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2";

export function ScheduleMonthView({
  anchorIso,
  todayISO,
  activityCountByDay,
  dueCountByDay,
  onDayTap,
  onPrevMonth,
  onNextMonth,
  onToday,
}: ScheduleMonthViewProps) {
  const grid = monthGrid(anchorIso);

  return (
    <div className="flex flex-col gap-2">
      {/* Header: ‹ month › + today jump */}
      <div className="flex items-center gap-1">
        <button type="button" aria-label="เดือนก่อนหน้า" onClick={onPrevMonth} className={NAV_BTN}>
          <ChevronLeft aria-hidden className="h-5 w-5" />
        </button>
        <p className="text-body text-ink min-w-28 text-center font-bold">{grid.label}</p>
        <button type="button" aria-label="เดือนถัดไป" onClick={onNextMonth} className={NAV_BTN}>
          <ChevronRight aria-hidden className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onToday}
          className="rounded-control border-edge bg-card text-ink-secondary hover:text-ink hover:bg-sunk focus-visible:ring-action text-meta ml-auto inline-flex h-11 items-center border px-3 font-semibold transition-colors focus:outline-none focus-visible:ring-2"
        >
          วันนี้
        </button>
      </div>

      <div className="border-edge bg-card rounded-card overflow-hidden border">
        {/* Weekday header — Sunday-first */}
        <div className="border-edge-strong grid grid-cols-7 border-b">
          {THAI_WEEKDAYS.map((wd, i) => (
            <div
              key={wd}
              className={`text-meta py-1.5 text-center font-semibold ${
                i === 0 || i === 6 ? "text-ink-muted" : "text-ink-secondary"
              }`}
            >
              {wd}
            </div>
          ))}
        </div>

        {grid.weeks.map((week, wi) => (
          <div key={wi} className="border-edge grid grid-cols-7 border-b last:border-b-0">
            {week.map((cell) => {
              const active = activityCountByDay[cell.iso] ?? 0;
              const due = dueCountByDay[cell.iso] ?? 0;
              const isToday = cell.iso === todayISO;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  aria-label={cellAriaLabel(cell.iso, cell.day, active, due)}
                  onClick={() => onDayTap(cell.iso)}
                  className={`border-edge focus-visible:ring-action relative flex min-h-14 flex-col items-center gap-0.5 border-r py-1.5 transition-colors last:border-r-0 focus:outline-none focus-visible:ring-2 ${
                    cell.inMonth
                      ? cell.isWeekend
                        ? "bg-sunk/40 hover:bg-sunk"
                        : "bg-card hover:bg-sunk"
                      : "bg-sunk/60 opacity-50"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] leading-none font-semibold ${
                      isToday ? "bg-fill text-on-fill" : "text-ink"
                    }`}
                  >
                    {cell.day}
                  </span>
                  {active > 0 && (
                    <span className="text-done flex items-center gap-0.5 text-[10px] font-bold">
                      <span className="bg-done inline-block h-1.5 w-1.5 rounded-full" />
                      {active}
                    </span>
                  )}
                  {due > 0 && (
                    <span
                      className={`absolute top-1 right-1 inline-block h-1.5 w-1.5 rounded-full ${
                        cell.iso < todayISO ? "bg-danger" : "bg-attn"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Cell legend */}
      <div className="text-ink-secondary text-meta flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className="bg-done inline-block h-1.5 w-1.5 rounded-full" /> จำนวนงานที่มีรูปวันนั้น
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-attn inline-block h-1.5 w-1.5 rounded-full" /> มีงานครบกำหนด
        </span>
        <span className="text-ink-muted">แตะวันเพื่อดูรายละเอียด</span>
      </div>
    </div>
  );
}
