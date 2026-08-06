// Spec 400 U1 — ตารางเช็คชื่อ, the worker × day grid.
//
// Extracted from the page for the reason spec 358 U3 extracted its drill: the
// page is a Server Component, so inline markup leaves the Thai strings, the
// shading and the link idiom unpinned — and three of that unit's review findings
// were invisible to a 5,100-test suite for exactly that reason. Presentational
// only: no fetching, no client hooks, no 'use client'.
//
// The wording of the two facts this surface SHARES with the list view comes from
// the list's own helpers (`openSessionLabel`, `dayClosureLabel`), never from a
// re-derivation here — spec 358 U3's lesson, where the drill printed the exact
// wording the summary had deliberately rejected and nothing failed.

import Link from "next/link";
import { EmptyNotice } from "@/components/features/common/notices";
import { formatThaiDate } from "@/lib/i18n/labels";
import { dayClosureLabel, openSessionLabel } from "@/lib/muster/attendance-audit";
import {
  MAX_GRID_DAYS,
  type AttendanceGrid,
  type GridCell,
  type GridDay,
} from "@/lib/muster/attendance-grid";

function formatNumber(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 1 });
}

/** Every finding a cell carries, in the words the list view already uses. */
function cellFindings(cell: GridCell, date: string, todayIso: string): string[] {
  const out: string[] = [];
  if (cell.manualIn) out.push("บันทึกมือ");
  if (cell.openOut) out.push(openSessionLabel({ workDate: date }, todayIso));
  if (cell.autoOut) out.push("ออกอัตโนมัติ");
  if (cell.outNextDay) out.push("ออกวันถัดไป");
  return out;
}

/** The cell's full story, for a screen reader and for the title of the mark.
 *  The visible cell shows the check-in time only — 31 columns of prose is not
 *  scannable, and scanning is the whole point of the shape. */
function cellLabel(workerName: string, date: string, cell: GridCell, todayIso: string): string {
  const parts = [`${workerName} ${formatThaiDate(date)}`];
  parts.push(cell.inTime ? `เข้า ${cell.inTime}` : "ไม่มีเวลาเข้า");
  if (cell.outTime) parts.push(`ออก ${cell.outTime}`);
  if (cell.otHours > 0) parts.push(`OT ${formatNumber(cell.otHours)} ชม.`);
  return [...parts, ...cellFindings(cell, date, todayIso)].join(" · ");
}

function DayHeader({ day, todayIso }: { day: GridDay; todayIso: string }) {
  const dayNumber = Number(day.date.slice(8, 10));
  // Closure is a PROJECT-DAY fact and belongs here, once, not on 41 cells.
  // `null` = the day carries no rows at all, which is not the same as "open".
  const closure =
    day.dayClosed === null
      ? null
      : dayClosureLabel({ workDate: day.date, dayClosed: day.dayClosed }, todayIso);
  return (
    <th
      scope="col"
      className={`border-edge min-w-14 border-b px-1 py-2 text-center align-bottom font-normal ${
        day.nonWorking ? "bg-sunk" : ""
      }`}
    >
      <span className="text-ink block text-xs font-semibold">{dayNumber}</span>
      {day.holidayName !== null && (
        <span className="text-ink-secondary mt-0.5 block text-[10px] leading-tight">
          {day.holidayName}
        </span>
      )}
      <span className="text-ink-secondary mt-0.5 block text-[10px]">{day.headcount}</span>
      {closure !== null && (
        <span
          aria-label={`${formatThaiDate(day.date)} ${closure}`}
          className={`mx-auto mt-1 block size-1.5 rounded-full ${
            day.dayClosed === true ? "bg-done" : "bg-attn"
          }`}
        />
      )}
    </th>
  );
}

export function AttendanceGridView({
  grid,
  todayIso,
  workerHref,
}: {
  grid: AttendanceGrid;
  todayIso: string;
  /**
   * Spec 400 D9 — the per-worker calendar (spec 374) gates on
   * WORKER_ROSTER_ROLES, which is NARROWER than ATTENDANCE_AUDIT_ROLES:
   * accounting, hr and project_coordinator read this report and would meet a
   * redirect. `null` withholds the LINK only, never the row.
   */
  workerHref: ((workerId: string) => string) | null;
}) {
  if (grid.tooWide) {
    // Retryable, so the copy names the way out — the range is the reader's own
    // input and narrowing it works immediately.
    return (
      <EmptyNotice>
        {`ช่วงวันที่กว้างเกินไปสำหรับมุมมองตาราง — เลือกช่วงไม่เกิน ${MAX_GRID_DAYS} วัน หรือดูมุมมองรายการ`}
      </EmptyNotice>
    );
  }
  if (grid.rows.length === 0) {
    return <EmptyNotice>ไม่มีบันทึกการเช็คชื่อในช่วงนี้</EmptyNotice>;
  }

  return (
    <div>
      {/* The legend is not decoration: a mark nobody can decode is noise, and
          the shading is what stops an empty Sunday reading as a finding. */}
      <ul className="text-ink-secondary mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <li className="flex items-center gap-1">
          <span className="bg-attn inline-block size-1.5 rounded-full" />
          มีข้อสังเกต
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-done inline-block size-1.5 rounded-full" />
          ปิดวันแล้ว
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-sunk border-edge inline-block size-2 border" />
          วันหยุด
        </li>
        <li>ตัวเลขใต้วันที่ = จำนวนคนที่เช็คชื่อ</li>
      </ul>

      {/* A bare overflow-x-auto row lets a horizontal swipe bleed into a
          vertical page jump; the pair is the repo-wide contract. */}
      <div className="border-edge rounded-card [touch-action:pan-x_pinch-zoom] overflow-x-auto border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th
                scope="col"
                className="border-edge bg-card sticky left-0 z-10 border-r border-b px-3 py-2 text-left align-bottom"
              >
                ช่าง
              </th>
              {grid.days.map((day) => (
                <DayHeader key={day.date} day={day} todayIso={todayIso} />
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.workerId}>
                <th
                  scope="row"
                  className="border-edge bg-card sticky left-0 z-10 max-w-40 border-r border-b px-3 py-1.5 text-left font-normal"
                >
                  {workerHref ? (
                    <Link
                      href={workerHref(row.workerId)}
                      className="text-action inline-flex min-h-11 items-center truncate underline-offset-2 hover:underline"
                    >
                      {row.workerName}
                    </Link>
                  ) : (
                    <span className="text-ink block truncate">{row.workerName}</span>
                  )}
                  <span className="text-ink-secondary block text-[10px]">
                    {row.daysPresent} วัน
                    {row.otHoursTotal > 0 ? ` · OT ${formatNumber(row.otHoursTotal)} ชม.` : ""}
                  </span>
                </th>
                {grid.days.map((day) => {
                  const cell = row.cells[day.date];
                  const findings = cell ? cellFindings(cell, day.date, todayIso) : [];
                  return (
                    <td
                      key={day.date}
                      {...(cell
                        ? {
                            "aria-label": cellLabel(row.workerName, day.date, cell, todayIso),
                            ...(findings.length > 0 ? { "data-finding": "true" } : {}),
                          }
                        : {})}
                      className={`border-edge border-b px-1 py-1.5 text-center align-middle ${
                        day.nonWorking ? "bg-sunk" : ""
                      }`}
                    >
                      {cell ? (
                        <span className="inline-flex items-center gap-0.5">
                          <span className="text-ink">{cell.inTime ?? "—"}</span>
                          {findings.length > 0 && (
                            <span className="bg-attn inline-block size-1.5 shrink-0 rounded-full" />
                          )}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
