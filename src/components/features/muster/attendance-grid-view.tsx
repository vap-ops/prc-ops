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
import { gridCellFixable, unfinishedDays } from "@/lib/muster/day-fix";

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
  dayHref,
}: {
  day: GridDay;
  todayIso: string;
  showMonth: boolean;
  /** Spec 400 U3b — opens the day panel. `null` withholds the LINK only; every
   *  fact in this header still renders (the spec 397 U3 rule). Unreachable since
   *  U6c widened MUSTER_REOPEN_ROLES to the whole audit audience; kept against a
   *  future narrowing. */
  dayHref: ((date: string) => string) | null;
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
  const body = (
    <>
      {showMonth && (
        <span className="text-ink-secondary block text-[10px] leading-tight">
          {THAI_MONTH.format(new Date(`${day.date}T00:00:00Z`))}
        </span>
      )}
      <span className={`block text-xs font-semibold ${dayHref ? "text-action" : "text-ink"}`}>
        {dayNumber}
      </span>
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
    </>
  );
  return (
    <th
      scope="col"
      className={`border-edge min-w-14 border-b px-1 py-2 text-center align-bottom font-normal ${
        day.nonWorking ? "bg-sunk" : ""
      }`}
    >
      {dayHref ? (
        // The whole header is the target: a bare day NUMBER is a ~10px tap on a
        // gloved hand, and the month/headcount/closure lines are what the reader
        // is aiming at anyway. min-h-11 because the commonest column state (no
        // month row, no closure bar) is only ~42px of content.
        //
        // ⚠️ The label CARRIES the column's facts rather than replacing them. An
        // author-supplied aria-label on the link wins over its subtree AND
        // becomes the <th>'s accessible name, so `แก้ไขวัน 4 ส.ค. 2569` alone
        // would silently strip the headcount and the closure state from what a
        // screen reader announces for all 42 cells of that column — leaving the
        // roles that got the CONTROL hearing strictly less than the roles that
        // did not. Withholding the control must not withhold the fact, and
        // granting it must not either.
        <Link
          href={dayHref(day.date)}
          aria-label={[`แก้ไขวัน ${formatThaiDate(day.date)}`, `${day.headcount} คน`, closure]
            .filter(Boolean)
            .join(" · ")}
          className="focus-visible:ring-action flex min-h-11 flex-col justify-end rounded px-1 py-1 focus:outline-none focus-visible:ring-2"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </th>
  );
}

export function AttendanceGridView({
  grid,
  todayIso,
  workerHref,
  dayHref = null,
  cellFixHref = null,
  canFixGaps = false,
}: {
  grid: AttendanceGrid;
  todayIso: string;
  /**
   * Spec 400 U6b — a cell's link to the U6a worker-day fix screen.
   *
   * `null` for every role outside MUSTER_CORRECT_ROLES.
   *
   * ⚠️ Spec 400 U6c made that set EQUAL to this page's ATTENDANCE_AUDIT_ROLES gate,
   * so today no reader is withheld. Until then the five audit roles were refused by
   * every correction RPC with 42501 and a link would have been affordance-then-
   * refuse — which is why the withholding branch exists and stays: the operator
   * reserved narrowing the audience again. When it is withheld, every FACT the cell
   * states still renders; only the link goes.
   */
  cellFixHref?: ((workerId: string, date: string) => string) | null;
  /**
   * A project is picked, so the fix screen can resolve one for a cell that has
   * NO session to infer it from. Gap cells do not link without this: the page
   * would render its `noProject` arm and offer the reader a sentence.
   */
  canFixGaps?: boolean;
  /**
   * Spec 400 U3b — opens the ?day= correction panel. `null` for the roles that
   * may neither close nor reopen (accounting, hr, project_coordinator,
   * project_manager): the panel would carry nothing but facts the column header
   * already states, so the link would be a promise of an action they cannot take.
   */
  dayHref?: ((date: string) => string) | null;
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

  // Spec 400 U6b — the days whose correction loop is UNFINISHED. Amber, and it
  // earns the colour: measured 2026-08-07, all 13 past days carrying attendance
  // are closed, so this is empty against production rather than permanent.
  //
  // The banner is a FACT about the day, so it renders for the whole audience —
  // including the roles that get no cell link. Closing is MUSTER_CLOSE_ROLES,
  // a different set again, and `dayHref` already withholds the control from
  // whoever may not act; the statement is not withheld from anyone.
  const unfinished = unfinishedDays(grid.days, todayIso);

  return (
    <div>
      {/* No `role="status"` on the banner: it is static server-rendered prose. A
          live region announces CHANGES, so on a server navigation it adds nothing,
          and marking static content as one competes with the day panel's real
          outcome messages. The aria-label makes it a findable region instead. */}
      {unfinished.length > 0 && (
        <div
          aria-label="วันที่ยังไม่ปิด"
          className="border-attn bg-attn-soft text-ink rounded-card mb-2 border px-3 py-2 text-xs"
        >
          {/* Says what the data supports and no more. A day in this set may have
              been reopened and left open, or never closed at all — the grid
              carries no reopen history, so copy claiming "reopened" would assert
              what cannot be known here. Both states need the same act. */}
          <p className="font-semibold">
            {`มี ${unfinished.length} วันที่ผ่านไปแล้วแต่ยังไม่ปิด — ค่าแรงของวันดังกล่าวยังไม่ถูกบันทึก`}
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {unfinished.map((d) => (
              <li key={d.date}>
                {dayHref ? (
                  <Link
                    href={dayHref(d.date)}
                    aria-label={`ปิดวัน ${formatThaiDate(d.date)}`}
                    className="text-action inline-flex min-h-11 items-center underline-offset-2 hover:underline"
                  >
                    {formatThaiDate(d.date)}
                  </Link>
                ) : (
                  <span>{formatThaiDate(d.date)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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

      {/* Tall multi-row grid — [touch-action:manipulation] (not the
          strip-form pan-x_pinch-zoom pair) so a vertical touch starting on
          the grid still scrolls the page; see MANIPULATION_ALLOWED_FILES
          in tests/unit/ui-class-contracts.test.tsx. */}
      <div className="border-edge rounded-card [touch-action:manipulation] overflow-x-auto border">
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
                  dayHref={dayHref}
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
                  // The cell's whole story, identical whether or not it links —
                  // withholding the control must not withhold the fact, and
                  // GRANTING it must not either (the U3b <th> lesson).
                  const label = cell
                    ? cellLabel(row.workerName, day.date, cell, todayIso)
                    : `${row.workerName} ${formatThaiDate(day.date)} ${
                        day.nonWorking ? "วันหยุด" : "ไม่มีการเช็คชื่อ"
                      }`;
                  const fixable =
                    cellFixHref !== null &&
                    gridCellFixable({
                      hasSession: cell !== undefined,
                      hasFindings: findings.length > 0,
                      day,
                      canFixGaps,
                    });
                  const body = cell ? (
                    <span className="inline-flex items-center gap-0.5">
                      <span className="text-ink">{cell.inTime ?? "—"}</span>
                      {findings.length > 0 && (
                        <span className="bg-attn inline-block size-1.5 shrink-0 rounded-full" />
                      )}
                    </span>
                  ) : null;
                  return (
                    <td
                      key={day.date}
                      // An EMPTY cell is announced too: without this, "never
                      // scanned" and "it was a Sunday" are the same silence to a
                      // screen reader, and only one of them is a finding.
                      //
                      // Dropped when the cell LINKS: the link carries the same
                      // label, and both would read the whole story twice per
                      // cell — 546 times on the live grid.
                      {...(fixable ? {} : { "aria-label": label })}
                      className={`border-edge border-b px-1 py-1.5 text-center align-middle ${
                        day.nonWorking ? "bg-sunk" : ""
                      }`}
                    >
                      {fixable ? (
                        <Link
                          href={cellFixHref(row.workerId, day.date)}
                          // Facts FIRST, then the act: a screen reader hearing
                          // this in a 13-column row needs to know which cell it
                          // is before what it can do about it.
                          aria-label={`${label} · แก้ไข`}
                          className="focus-visible:ring-action flex min-h-11 items-center justify-center rounded focus:outline-none focus-visible:ring-2"
                        >
                          {/* A gap cell has no time to show, so the door needs a
                              visible mark or it is an invisible tap target. `+`
                              reads as "add the missing check-in" and is not
                              colour-dependent. */}
                          {body ?? <span className="text-action text-sm leading-none">+</span>}
                        </Link>
                      ) : (
                        body
                      )}
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
