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

/** Short Thai month for a column header, same era + zone pins as formatThaiDate.
 *  The range may span up to MAX_GRID_DAYS, so a bare day number would read
 *  `…30 31 1 2…` with nothing saying which month the 1 belongs to. */
const THAI_MONTH = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  month: "short",
  timeZone: "Asia/Bangkok",
});

/** Every finding a cell carries, in the words the surfaces around it use.
 *  `(+1 วัน)` is the wording BOTH the list drill and the spec-374 calendar
 *  already print for this fact — a third name for it, one click apart, is the
 *  drift this module exists to avoid. */
function cellFindings(cell: GridCell, date: string, todayIso: string): string[] {
  const out: string[] = [];
  if (cell.manualIn) out.push("บันทึกมือ");
  if (cell.openOut) out.push(openSessionLabel({ workDate: date }, todayIso));
  if (cell.autoOut) out.push("ออกอัตโนมัติ");
  if (cell.outNextDay) out.push("(+1 วัน)");
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

function DayHeader({
  day,
  todayIso,
  showMonth,
}: {
  day: GridDay;
  todayIso: string;
  showMonth: boolean;
}) {
  const dayNumber = Number(day.date.slice(8, 10));
  // Closure is a PROJECT-DAY fact and belongs here, once, not on 41 cells.
  //
  // The MARK is narrower than the label on purpose. `dayClosed === false` is the
  // normal state of the current day — the default month-to-date range always
  // includes it — so an attn dot there would paint the rightmost column amber
  // every single day and re-create, at the header, the cry-wolf failure the
  // non-working shading exists to prevent. An unclosed day is only a FINDING
  // once the day is over, exactly the split dayClosureLabel already makes.
  const closure =
    day.dayClosed === null
      ? null
      : dayClosureLabel({ workDate: day.date, dayClosed: day.dayClosed }, todayIso);
  const mark =
    day.dayClosed === true
      ? "done"
      : day.dayClosed === false && day.date < todayIso
        ? "attn"
        : null;
  return (
    <th
      scope="col"
      className={`border-edge min-w-14 border-b px-1 py-2 text-center align-bottom font-normal ${
        day.nonWorking ? "bg-sunk" : ""
      }`}
    >
      {showMonth && (
        <span className="text-ink-secondary block text-[10px] leading-tight">
          {THAI_MONTH.format(new Date(`${day.date}T00:00:00Z`))}
        </span>
      )}
      <span className="text-ink block text-xs font-semibold">{dayNumber}</span>
      {day.holidayName !== null && (
        <span className="text-ink-secondary mt-0.5 block text-[10px] leading-tight">
          {day.holidayName}
        </span>
      )}
      <span className="text-ink-secondary mt-0.5 block text-[10px]">{day.headcount}</span>
      {mark !== null && closure !== null && (
        <span
          aria-label={`${formatThaiDate(day.date)} ${closure}`}
          // A BAR, not a dot: the cell mark is a dot meaning "this cell has a
          // finding", so reusing that shape here would give one glyph two
          // meanings on one screen. Shape carries the distinction, colour only
          // the severity.
          className={`mx-auto mt-1 block h-0.5 w-3 rounded-full ${
            mark === "done" ? "bg-done" : "bg-attn"
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
          จุดในช่อง = มีข้อสังเกต
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-done inline-block h-0.5 w-3 rounded-full" />
          ปิดวันแล้ว
        </li>
        <li className="flex items-center gap-1">
          <span className="bg-attn inline-block h-0.5 w-3 rounded-full" />
          วันที่ผ่านไปแล้วแต่ยังไม่ปิด
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
              {grid.days.map((day, i) => (
                <DayHeader
                  key={day.date}
                  day={day}
                  todayIso={todayIso}
                  // Name the month on the first column and wherever it turns
                  // over — a 92-day range can cross four of them.
                  showMonth={i === 0 || day.date.slice(0, 7) !== grid.days[i - 1]?.date.slice(0, 7)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.workerId}>
                <th
                  scope="row"
                  className="border-edge bg-card sticky left-0 z-10 border-r border-b px-3 py-1.5 text-left font-normal"
                >
                  {/* The width lives on an inner block, not on the <th>: this
                      table is auto-layout, where a th sizes to its content and
                      max-w- is merely advisory, so a long Thai name would widen
                      the sticky column instead of truncating. */}
                  <div className="w-36">
                    {workerHref ? (
                      <Link
                        href={workerHref(row.workerId)}
                        className="text-action flex min-h-11 items-center truncate underline-offset-2 hover:underline"
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
                  </div>
                </th>
                {grid.days.map((day) => {
                  const cell = row.cells[day.date];
                  const findings = cell ? cellFindings(cell, day.date, todayIso) : [];
                  return (
                    <td
                      key={day.date}
                      // An EMPTY cell is announced too: without this, "never
                      // scanned" and "it was a Sunday" are the same silence to a
                      // screen reader, and only one of them is a finding.
                      aria-label={
                        cell
                          ? cellLabel(row.workerName, day.date, cell, todayIso)
                          : `${row.workerName} ${formatThaiDate(day.date)} ${
                              day.holidayName ?? (day.nonWorking ? "วันหยุด" : "ไม่มีการเช็คชื่อ")
                            }`
                      }
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
