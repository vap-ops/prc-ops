"use client";

// Spec 256 U2 — week + day agendas. Week = 7 stacked day sections (compact
// chips); day = one date expanded into sections (มีงานจริง / ครบกำหนดวันนี้ /
// เริ่มตามแผน). Chips/rows link to WP detail with the schedule as back-referrer.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { workPackageHref, scheduleHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { weekOf, THAI_WEEKDAYS } from "@/lib/work-packages/calendar-grid";
import { THAI_MONTHS } from "@/lib/work-packages/gantt-scale";
import type { GanttWp } from "@/components/features/work-packages/schedule-gantt";

export interface DayEntries {
  /** WPs with photos that day + photo count. */
  active: Array<{ wp: GanttWp; photoCount: number }>;
  /** planned_end that day. */
  due: GanttWp[];
  /** planned_start that day. */
  starting: GanttWp[];
}

interface NavProps {
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  prevLabel: string;
  nextLabel: string;
  title: string;
}

const NAV_BTN =
  "rounded-control text-ink-secondary hover:text-ink hover:bg-sunk focus-visible:ring-action inline-flex h-11 w-11 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2";

function AgendaNav({ onPrev, onNext, onToday, prevLabel, nextLabel, title }: NavProps) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={prevLabel} onClick={onPrev} className={NAV_BTN}>
        <ChevronLeft aria-hidden className="h-5 w-5" />
      </button>
      <p className="text-body text-ink min-w-28 text-center font-bold">{title}</p>
      <button type="button" aria-label={nextLabel} onClick={onNext} className={NAV_BTN}>
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
  );
}

function thaiDate(iso: string): string {
  const dow = new Date(Date.parse(`${iso}T00:00:00Z`)).getUTCDay();
  const day = Number(iso.slice(8, 10));
  const month = THAI_MONTHS[Number(iso.slice(5, 7)) - 1];
  return `${THAI_WEEKDAYS[dow]} ${day} ${month}`;
}

function WpLink({ projectId, wp, meta }: { projectId: string; wp: GanttWp; meta?: string }) {
  return (
    <Link
      href={withBackFrom(workPackageHref(projectId, wp.id), scheduleHref(projectId))}
      className="border-edge bg-card hover:bg-sunk focus-visible:ring-action rounded-control flex min-h-11 items-center gap-2 border px-3 py-1.5 transition-colors focus:outline-none focus-visible:ring-2"
    >
      <span className="text-ink-secondary text-meta shrink-0 font-mono">{wp.code}</span>
      <span className="text-ink text-body min-w-0 flex-1 truncate font-semibold">{wp.name}</span>
      {meta && <span className="text-ink-secondary text-meta shrink-0">{meta}</span>}
    </Link>
  );
}

// ---------------------------------------------------------------------------

interface ScheduleDayViewProps {
  projectId: string;
  iso: string;
  todayISO: string;
  entries: DayEntries;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function ScheduleDayView({
  projectId,
  iso,
  todayISO,
  entries,
  onPrev,
  onNext,
  onToday,
}: ScheduleDayViewProps) {
  const beYear = Number(iso.slice(0, 4)) + 543;
  const isEmpty =
    entries.active.length === 0 && entries.due.length === 0 && entries.starting.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <AgendaNav
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        prevLabel="วันก่อนหน้า"
        nextLabel="วันถัดไป"
        title={`${thaiDate(iso)} ${beYear}${iso === todayISO ? " (วันนี้)" : ""}`}
      />

      {isEmpty ? (
        <div className="border-edge bg-card text-ink-secondary rounded-card text-body border p-6 text-center">
          ไม่มีข้อมูลในวันนี้ — แตะลูกศรเพื่อดูวันอื่น หรือกลับไปมุมมองเดือน
        </div>
      ) : (
        <>
          {entries.active.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-meta text-ink-secondary font-bold">มีงานจริง</h3>
              {entries.active.map(({ wp, photoCount }) => (
                <WpLink key={wp.id} projectId={projectId} wp={wp} meta={`${photoCount} รูป`} />
              ))}
            </section>
          )}
          {entries.due.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-meta text-ink-secondary font-bold">ครบกำหนดวันนี้</h3>
              {entries.due.map((wp) => (
                <WpLink key={wp.id} projectId={projectId} wp={wp} />
              ))}
            </section>
          )}
          {entries.starting.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-meta text-ink-secondary font-bold">เริ่มตามแผน</h3>
              {entries.starting.map((wp) => (
                <WpLink key={wp.id} projectId={projectId} wp={wp} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ScheduleWeekViewProps {
  projectId: string;
  anchorIso: string;
  todayISO: string;
  entriesFor: (iso: string) => DayEntries;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function ScheduleWeekView({
  projectId,
  anchorIso,
  todayISO,
  entriesFor,
  onPrev,
  onNext,
  onToday,
}: ScheduleWeekViewProps) {
  const days = weekOf(anchorIso);
  const first = days[0]!;
  const last = days[6]!;
  const title = `${Number(first.slice(8, 10))}–${Number(last.slice(8, 10))} ${
    THAI_MONTHS[Number(last.slice(5, 7)) - 1]
  } ${Number(last.slice(0, 4)) + 543}`;

  return (
    <div className="flex flex-col gap-3">
      <AgendaNav
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        prevLabel="สัปดาห์ก่อนหน้า"
        nextLabel="สัปดาห์ถัดไป"
        title={title}
      />

      <div className="flex flex-col gap-2">
        {days.map((iso) => {
          const e = entriesFor(iso);
          const isToday = iso === todayISO;
          const empty = e.active.length === 0 && e.due.length === 0 && e.starting.length === 0;
          return (
            <div
              key={iso}
              className={`border-edge rounded-card border ${isToday ? "bg-attn-soft/30" : "bg-card"} ${
                empty ? "py-1.5" : "py-2"
              } px-3`}
            >
              <p className={`text-meta font-bold ${isToday ? "text-ink" : "text-ink-secondary"}`}>
                {thaiDate(iso)}
                {isToday && " · วันนี้"}
              </p>
              {!empty && (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {e.active.map(({ wp, photoCount }) => (
                    <WpLink
                      key={`a-${wp.id}`}
                      projectId={projectId}
                      wp={wp}
                      meta={`${photoCount} รูป`}
                    />
                  ))}
                  {e.due.map((wp) => (
                    <WpLink key={`d-${wp.id}`} projectId={projectId} wp={wp} meta="ครบกำหนด" />
                  ))}
                  {e.starting.map((wp) => (
                    <WpLink key={`s-${wp.id}`} projectId={projectId} wp={wp} meta="เริ่มตามแผน" />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
