"use client";

// Spec 388 U4 — the ช่าง's attendance as a month grid.
//
// WHY A GRID REPLACED U2's LIST. Live density is 1.43 sessions per worked day
// (OT is not rare — 59 of 195 rows), so a steady month is ~37 rows per ช่าง ≈
// 5–6 phone screens of cards. That is the same infinite-scroll shape spec 384
// had to undo on the SA home. A month fits one screen as a grid.
//
// WHY 'use client' (CLAUDE.md requires the justification). Selecting a day is a
// pure presentation change over data the page has ALREADY sent: the whole
// month's sessions are in the payload. Making it a server round-trip would put
// a network hop between a gloved tap and a date cell, on site, on the worst
// connection any surface in this app has to survive. Month NAVIGATION is still
// a real link (?m=), because that genuinely needs different data.
//
// WHAT A CELL MAY CLAIM. A day is painted late only when a REGULAR, QR-scanned
// session was late — the same rule the row view applies, reused rather than
// restated, so a manual row (the SA's tap, not the worker's arrival) can never
// colour a worker's calendar. The sessions themselves render through the U2
// row component, so ปิดอัตโนมัติ / บันทึกโดยหัวหน้า / the open-day case cannot
// drift between the two surfaces.

import { useState } from "react";
import Link from "next/link";
import { CARD } from "@/lib/ui/classes";
import { EmptyNotice } from "@/components/features/common/notices";
import { THAI_WEEKDAYS } from "@/lib/work-packages/calendar-grid";
import {
  ATTENDANCE_LATE_LABEL,
  ATTENDANCE_ON_TIME_LABEL,
  ATTENDANCE_OT_SESSION_LABEL,
  ATTENDANCE_OWN_EMPTY_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import { AttendanceRows, AttendanceSummaryCard } from "./worker-attendance-list";
import type { AttendanceMonthView } from "@/lib/attendance/attendance-sessions";

/** The most recent day in the month that has any record — the default open. */
function latestRecordedDay(days: AttendanceMonthView["days"]): string | null {
  const keys = Object.keys(days).sort();
  return keys.length > 0 ? (keys[keys.length - 1] ?? null) : null;
}

export function WorkerAttendanceMonth({
  view,
  prevHref,
  nextHref,
}: {
  view: AttendanceMonthView;
  prevHref: string;
  nextHref: string;
}) {
  const { grid, days, summary } = view;
  const [selected, setSelected] = useState<string | null>(() => latestRecordedDay(days));
  const selectedDay = selected ? days[selected] : undefined;
  const hasAnyRecord = Object.keys(days).length > 0;

  return (
    <>
      <AttendanceSummaryCard summary={summary} />

      <div className={`${CARD} mb-4`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <Link
            href={prevHref}
            aria-label="เดือนก่อนหน้า"
            className="text-action rounded-control px-2 py-1 text-sm font-semibold"
          >
            ‹ เดือนก่อน
          </Link>
          <p data-testid="attendance-month-label" className="text-ink text-sm font-bold">
            {grid.label}
          </p>
          <Link
            href={nextHref}
            aria-label="เดือนถัดไป"
            className="text-action rounded-control px-2 py-1 text-sm font-semibold"
          >
            เดือนถัดไป ›
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {THAI_WEEKDAYS.map((w) => (
            <div key={w} className="text-ink-secondary py-1 text-center text-xs font-semibold">
              {w}
            </div>
          ))}

          {grid.weeks.flat().map((cell) => {
            const state = days[cell.iso];
            // A day with no record is not a control — there is nothing to open,
            // and a tappable blank would promise detail that does not exist.
            if (!state) {
              return (
                <div
                  key={cell.iso}
                  className={`py-2 text-center text-sm tabular-nums ${
                    cell.inMonth ? "text-ink-secondary" : "text-ink-muted opacity-40"
                  }`}
                >
                  {cell.day}
                </div>
              );
            }
            const isSelected = cell.iso === selected;
            // The dots carry the verdict and `hasOt` by COLOUR alone, so the
            // state must also reach the accessible name — otherwise a screen
            // reader gets a bare "24" and neither the date nor what happened.
            // ⚠️ `none` contributes NO word: a day whose only regular session was
            // entered manually has no verifiable arrival, and naming it ตรงเวลา
            // would assert punctuality the app cannot stand behind.
            const stateWords = [
              state.verdict === "late"
                ? ATTENDANCE_LATE_LABEL
                : state.verdict === "on_time"
                  ? ATTENDANCE_ON_TIME_LABEL
                  : null,
              state.hasOt ? ATTENDANCE_OT_SESSION_LABEL : null,
            ].filter(Boolean);
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => setSelected(cell.iso)}
                aria-pressed={isSelected}
                aria-label={`${formatThaiDate(cell.iso)} · ${stateWords.join(" · ")}`}
                data-late={String(state.late)}
                data-ot={String(state.hasOt)}
                className={`rounded-control flex flex-col items-center gap-0.5 border py-1.5 text-sm tabular-nums ${
                  isSelected ? "border-fill bg-fill text-on-fill font-bold" : "border-edge text-ink"
                }`}
              >
                <span>{cell.day}</span>
                <span className="flex h-1.5 items-center gap-0.5">
                  {/* Neutral for an unjudged day — a green dot on a
                      manually-entered day would claim punctuality nobody
                      verified. */}
                  <span
                    className={`block h-1.5 w-1.5 rounded-full ${
                      state.verdict === "late"
                        ? "bg-danger"
                        : state.verdict === "on_time"
                          ? "bg-done"
                          : "bg-ink-muted"
                    }`}
                  />
                  {state.hasOt ? <span className="bg-attn block h-1.5 w-1.5 rounded-full" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {hasAnyRecord && selectedDay ? (
        <div data-testid="attendance-day-detail">
          <h2 className="text-ink mb-2 text-sm font-bold">
            {selected ? formatThaiDate(selected) : ""}
          </h2>
          <AttendanceRows rows={selectedDay.sessions} testId="attendance-day-rows" />
        </div>
      ) : null}

      {hasAnyRecord ? null : <EmptyNotice>{ATTENDANCE_OWN_EMPTY_LABEL}</EmptyNotice>}
    </>
  );
}
