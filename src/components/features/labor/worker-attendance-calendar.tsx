// Spec 374 U1 — the per-worker attendance month calendar (ปฏิทินเข้างาน).
// Pure presentational and server-renderable: the page loads + builds the
// month, this renders it. Three blocks: worker header (rate + info), month
// summary (scanned / OT / estimate / paid variance + the cost-unconfirmed
// explainer), and the muster day grid. Month steppers are plain links so the
// whole surface stays a Server Component.

import Link from "next/link";
import { ChevronLeft, ChevronRight, Timer } from "lucide-react";

import type { AttendanceMonth } from "@/lib/attendance/attendance-month";
import { THAI_WEEKDAYS } from "@/lib/work-packages/calendar-grid";
import { bahtWithSymbol } from "@/lib/format";
import { CONFIRM_COST_LABEL, UNCONFIRMED_COST_LABEL } from "@/lib/i18n/labels";

export interface AttendanceWorkerHeader {
  id: string;
  name: string;
  levelLabel: string | null;
  dayRate: number | null;
  phone: string | null;
  payTypeLabel: string;
  active: boolean;
  costConfirmedAt: string | null;
  projectLabel: string | null;
}

const STEPPER =
  "rounded-control border-edge bg-card text-ink-secondary hover:text-ink hover:bg-sunk " +
  "focus-visible:ring-action inline-flex h-11 w-11 items-center justify-center border " +
  "transition-colors focus:outline-none focus-visible:ring-2";

function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

/**
 * Spec 404 U2 — what the cell's two glyphs mean, in words.
 *
 * The compact cell is the PRICE of the `md` split (§4.2): at iPad portrait a
 * column is ~71px wide and `17:00 (อัตโนมัติ)` needs ~80px, so the two word
 * markers shrink to a glyph and a `+1`.
 *
 * ⚠️ **Measured, and only PART of the plan lands.** Driven in real Chrome with
 * the panel open at 768 / 790 / 810 / 834 / 900 / 1024: the glyph swap (~40px,
 * the larger saving) works at every width, but the merged `07:42–18:00` line
 * needs ~70px against 66px of usable column at 834, so it wraps to two lines
 * from `md` up to ~880 and is one line above that. A 7-column grid with
 * readable 10px times and a usable panel does not fit side by side below ~880 —
 * the panel would have to shrink past 190px, which cannot hold two time inputs.
 * The band boundary is NOT moved to `lg` (the operator ruled that out: it would
 * appear and vanish on rotation), and nothing regresses — two lines is what this
 * cell rendered before this unit. The first probe missed this by measuring the
 * COLUMN and never the text inside it.
 *
 * ⚠️ U2b re-measured EVERY cell of three worker-months across 768…1194 rather
 * than the first one, and sharpened the above: the wrap boundary is **between
 * 834 and 860** (66px → 70px of column), and ONLY cells carrying the auto-out
 * glyph wrap — a bare `07:44–19:43` is one line at every width in the band. The
 * `lg` panel going 300 → 340 does not reach this: the whole wrapping interval is
 * below `lg`, where the panel is 280 either way. (The U2b probe's own first pass
 * sampled the FIRST cell of the month, which had no glyph, and briefly read as
 * "nothing wraps" — the same sampling error, one level up.)
 *
 * The words survive in TWO places, and both are load-bearing:
 *
 *  - an `sr-only` span inside the cell, so a listener loses nothing (the U6b
 *    aria-label defect, running the other way: a compact cell that says less);
 *  - this legend, rendered under the grid ONLY on a month that actually carries
 *    the marker, so a sighted reader can decode the glyph.
 *
 * ⚠️ Deliberately NOT "the words move into the panel". The panel is gated on
 * MUSTER_CORRECT_ROLES and only renders while it is open, so parking the words
 * there would withhold them from exactly the readers who cannot open it.
 */
const AUTO_OUT_LEGEND = "ระบบปิดเวลาให้อัตโนมัติเมื่อปิดวัน";
const NEXT_DAY_LEGEND = "ออกงานหลังเที่ยงคืน (นับเป็นวันถัดไป)";

export function WorkerAttendanceCalendar({
  month,
  worker,
  stdRate,
  prevHref,
  nextHref,
  dayFixHref = null,
  blankFixDates,
  openFixDate = null,
}: {
  month: AttendanceMonth;
  worker: AttendanceWorkerHeader;
  /** Standard gross rate for the worker's level — null when unset OR when the
   *  viewer is outside the /settings/labor-rates money audience. */
  stdRate: number | null;
  prevHref: string;
  nextHref: string;
  /**
   * Spec 400 U6b, re-aimed by 404 U2 — a day cell's door into the fix panel.
   *
   * `null` for every reader outside MUSTER_CORRECT_ROLES. This page's own gate is
   * WORKER_ROSTER_ROLES, which includes project_manager and project_director —
   * both refused by every correction RPC with 42501 — so the link is withheld
   * from them while every fact in the cell stays.
   *
   * U6b pointed this at `/team/attendance/fix`; U2 points it at THIS page's own
   * `?fix=<date>`, so a corrector never leaves the month they are reading.
   *
   * Days that carry attendance link, plus the blank days in `blankFixDates`.
   */
  dayFixHref?: ((date: string) => string) | null;
  /**
   * Spec 404 U2b — blank cells that are ALSO doors, decided by the page through
   * `calendarBlankDayFixable`.
   *
   * A day this worker has no row on, at a project that scanned other people, is
   * fully serviceable: `loadWorkerDayFix` offers เพิ่มคนที่ตกหล่น against that
   * day's existing team. Until U2b nothing linked it, so the screen built for
   * "the muster missed him" existed only at a hand-typed URL.
   *
   * ⚠️ It is a SET, not a predicate, because the rule needs a per-project
   * headcount read the calendar has no business doing — and because it must be
   * exactly the set the page also hands `fixStepDates`, or the grid and the
   * steppers would disagree about what the month holds.
   *
   * ⚠️ NOT every blank cell. Live in August that would be ~24 tap targets and
   * each unworked Sunday would read as a finding — the cry-wolf line U6b drew;
   * the rule yields ONE. A day the project never opened is excluded outright,
   * because the add path inserts into an EXISTING team and would refuse with
   * ยังไม่มีทีมของวันดังกล่าว.
   */
  blankFixDates?: ReadonlySet<string>;
  /**
   * Spec 404 U2 — the date the panel is currently open on, so the reader can
   * tell which of 42 cells it is about. `aria-current`, never an aria-label: it
   * annotates the link instead of replacing its subtree as the accessible name.
   */
  openFixDate?: string | null;
}) {
  const { summary } = month;
  const showStd = stdRate !== null && stdRate !== worker.dayRate;

  // Spec 404 U1 — the month's own projects, from the attendance rows. The
  // worker's `projectLabel` is where they are assigned NOW and is overwritten
  // by a move, so it cannot caption a past month; it appears below only under
  // its own label, and only when it is not already one of the month's.
  const { projectDays } = summary;
  const isSplit = projectDays.length > 1;
  const shortByLabel = new Map(projectDays.map((p) => [p.label, p.shortCode]));
  // ⚠️ NOT gated on `projectDays.length > 0`. A month with no attendance has no
  // project to name, but the reader still needs to know where this person is —
  // dropping the line entirely would REMOVE a signal the old header carried.
  // The line is honest either way, because it is labelled as an assignment
  // rather than as the month's project.
  const assignmentElsewhere =
    worker.projectLabel !== null && !projectDays.some((p) => p.label === worker.projectLabel);

  // Spec 404 U2 — the legend is derived from the RENDERED cells, so it can never
  // explain a glyph that is not on screen (or omit one that is).
  const monthCells = Object.values(month.cells);
  const hasAutoOut = monthCells.some((c) => c.outAuto);
  const hasNextDayOut = monthCells.some((c) => c.outNextDay);
  const holidayEntries = Object.entries(month.holidayByDate).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-4">
      {/* ── Worker header ─────────────────────────────────────────────── */}
      <section className="border-edge bg-card rounded-card border p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-ink text-base font-bold">{worker.name}</h2>
          {!worker.active ? (
            <span className="text-ink-muted text-xs font-medium">ปิดใช้งาน</span>
          ) : null}
        </div>
        <dl className="text-ink-secondary mt-2 flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium">ค่าแรง</dt>
            <dd className="text-ink font-semibold">
              {worker.dayRate === null ? "ยังไม่กำหนด" : `${bahtWithSymbol(worker.dayRate)} /วัน`}
            </dd>
            {showStd ? (
              <dd className="text-ink-muted text-xs">มาตรฐานระดับ {bahtWithSymbol(stdRate)}</dd>
            ) : null}
          </div>
          {worker.levelLabel ? (
            <div className="flex gap-2">
              <dt className="font-medium">ระดับ</dt>
              <dd>{worker.levelLabel}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="font-medium">การจ่าย</dt>
            <dd>{worker.payTypeLabel}</dd>
          </div>
          {worker.phone ? (
            <div className="flex gap-2">
              <dt className="font-medium">โทร</dt>
              <dd>{worker.phone}</dd>
            </div>
          ) : null}
          {/* Spec 404 U1 — a month with no attendance names NO project. The old
              fallback printed the current assignment, which for the ten workers
              moved on 2026-08-07 captioned months they never worked there. */}
          {projectDays.length > 0 ? (
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium">{isSplit ? "โครงการเดือนนี้" : "โครงการ"}</dt>
              {projectDays.map((p) => (
                <dd key={p.label} className={isSplit ? "basis-full" : undefined}>
                  {p.label}
                  {isSplit ? (
                    <span className="text-ink-secondary"> · {fmtDays(p.days)} วัน</span>
                  ) : null}
                </dd>
              ))}
            </div>
          ) : null}
          {assignmentElsewhere ? (
            <div className="text-ink-secondary flex gap-2 text-xs">
              <dt>ปัจจุบันอยู่ที่</dt>
              <dd>{worker.projectLabel}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {/* ── Month summary ─────────────────────────────────────────────── */}
      <section className="border-edge bg-card rounded-card border p-4">
        <p className="text-ink text-sm font-semibold">
          มาทำงาน {fmtDays(summary.daysScanned)} วัน
          {summary.otHoursTotal > 0 ? ` · OT รวม ${fmtDays(summary.otHoursTotal)} ชม.` : ""}
        </p>
        <p className="text-ink-muted mt-1 text-sm">
          ประมาณการค่าแรง{" "}
          {summary.estimatedGross === null ? "—" : bahtWithSymbol(summary.estimatedGross)}
          {/* Spec 404 U1 — ปัจจุบัน is load-bearing: this multiplies by the
              worker's CURRENT day_rate, and a project move is exactly when a
              rate changes, so an unqualified figure restates history. The
              per-day snapshot lives in labor_logs.day_rate_snapshot and belongs
              to the money unit (§7.5), not here. */}
          <span className="text-ink-secondary text-xs"> (จำนวนวัน × ค่าแรง/วัน ปัจจุบัน)</span>
        </p>
        <p className="text-ink-secondary mt-1 text-sm">
          บันทึกค่าแรงแล้ว {fmtDays(summary.paidDaysTotal)} วัน
          {summary.varianceDays !== 0 ? (
            <span className="text-attn-ink font-medium">
              {" "}
              · ต่างกัน {fmtDays(Math.abs(summary.varianceDays))} วัน
            </span>
          ) : null}
        </p>
        {/* derive_muster_labor (verified live) skips a worker until
            confirm_worker_cost stamps him — that is WHY scanned days can sit at
            N while recorded pay stays 0. Name the real affordance. */}
        {worker.costConfirmedAt === null ? (
          <p className="text-attn-ink mt-2 text-xs">
            {UNCONFIRMED_COST_LABEL} — ระบบจะยังไม่สร้างบันทึกค่าแรงจากการเช็คชื่อ จนกว่าจะกด &quot;
            {CONFIRM_COST_LABEL}&quot; ในหน้ารายชื่อช่าง
          </p>
        ) : null}
      </section>

      {/* ── Calendar ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Link href={prevHref} aria-label="เดือนก่อนหน้า" className={STEPPER}>
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </Link>
          <p className="text-body text-ink min-w-28 text-center font-bold">{month.grid.label}</p>
          <Link href={nextHref} aria-label="เดือนถัดไป" className={STEPPER}>
            <ChevronRight aria-hidden className="h-5 w-5" />
          </Link>
        </div>

        <div className="border-edge bg-card rounded-card overflow-hidden border">
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
          {month.grid.weeks.map((week, wi) => (
            <div key={wi} className="border-edge grid grid-cols-7 border-b last:border-b-0">
              {week.map((cell) => {
                const data = cell.inMonth ? month.cells[cell.iso] : undefined;
                const holiday = cell.inMonth ? month.holidayByDate[cell.iso] : undefined;
                // Spec 400 U6b — a day with attendance is a door; spec 404 U2b —
                // so is a blank day the project scanned other people on, which is
                // where the ADD arm does its work. Padding cells
                // (`inMonth === false`) resolve `data` to undefined and are
                // excluded from `blankFixDates` by the page, so they never link.
                const isDoor = Boolean(data) || (blankFixDates?.has(cell.iso) ?? false);
                const fixTo = isDoor && dayFixHref ? dayFixHref(cell.iso) : null;
                const isOpenFix = cell.inMonth && openFixDate === cell.iso;
                const inner = (
                  <>
                    <p
                      className={`text-meta text-right ${
                        data ? "text-ink font-semibold" : "text-ink-muted"
                      }`}
                    >
                      {cell.day}
                    </p>
                    {holiday ? (
                      // Spec 404 U2 — NO `title`. It carried the full name and
                      // was justified as "desktop back-office, where hover is
                      // real"; the operator reads this page on an iPad, where
                      // the attribute reaches nobody. The full name now sits in
                      // the legend under the grid, which every reader can reach
                      // on every device. Two lines here rather than one
                      // truncated: the longest live name is 50 characters, so a
                      // clamp is unavoidable, but two lines separate
                      // `วันเฉลิมพระชนมพรรษา…` from `ชดเชย…` at a glance.
                      <p className="text-attn-ink line-clamp-2 text-[10px] leading-tight">
                        {holiday}
                      </p>
                    ) : null}
                    {/* `data` includes paid-only cells (paper-backfilled labor
                        days) on purpose — a recorded labor day IS work on that
                        holiday, scan or no scan. */}
                    {holiday && data ? (
                      <p className="text-attn-ink text-[10px] leading-tight font-semibold">
                        ทำงานวันหยุด
                      </p>
                    ) : null}
                    {/* Spec 404 U2b — a blank door has no time to show, so
                        without a visible mark it is an invisible tap target.
                        The same GLYPH the grid's gap cells use, for the same
                        reason: it reads as an offer rather than a finding,
                        carries no colour dependence, and appears only where the
                        door does — an always-on mark would accuse every unworked
                        day of something. ⚠️ Only the glyph is shared: the grid
                        names its link `<facts> · แก้ไข`, deliberately generic,
                        and this cell's own name is generic for the same reason
                        (see the sr-only span below). */}
                    {!data && isDoor ? <p className="text-action text-sm leading-none">+</p> : null}
                    {data ? (
                      <div className="text-ink-secondary text-[10px] leading-tight tracking-tight">
                        {/* Spec 404 U2 — ONE time line, not two stacked ones.
                            At iPad portrait a column is 68px (834 − 40 padding
                            − 16 gap − 300 panel, ÷ 7), 60px usable. A missing
                            side renders as an OPEN interval (`08:15–`) rather
                            than a guess or a dropped line: a worker still
                            checked in is exactly what that says. */}
                        {data.inTime || data.outTime ? (
                          <p>
                            {data.inTime ?? ""}–{data.outTime ?? ""}
                            {/* The words the /team/attendance drill spells out
                                move to `sr-only` + the legend below the grid —
                                they cost ~80px here and the box is 60px. */}
                            {data.outNextDay ? (
                              <span className="text-ink-muted">
                                {" "}
                                +1<span className="sr-only">วัน</span>
                              </span>
                            ) : null}
                            {data.outAuto ? (
                              <span className="text-ink-muted">
                                {" "}
                                <Timer
                                  aria-hidden
                                  data-marker="auto"
                                  className="inline-block h-3 w-3 align-middle"
                                />
                                <span className="sr-only">(อัตโนมัติ)</span>
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                        {data.otHours > 0 ? (
                          <p className="text-attn-ink font-medium">+{fmtDays(data.otHours)} ชม.</p>
                        ) : null}
                        {data.inMethod === "manual" || data.outMethod === "manual" ? (
                          <p className="text-ink-muted">บันทึกมือ</p>
                        ) : null}
                        {/* Spec 404 U1 — badge on a SPLIT month only, and on
                            every attendance day in it. The old rule compared
                            the day against the worker's CURRENT assignment,
                            which inverts the moment they are moved: the
                            correctly-recorded days get badged while the
                            now-wrong header stays clean. `shortCode` drops the
                            prefix the month's own codes share (derived, not
                            hardcoded) so the tail survives a 60px cell. */}
                        {isSplit && data.projectName ? (
                          <p className="text-ink-muted font-medium">
                            {shortByLabel.get(data.projectName) ?? data.projectName.split(" ")[0]}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                );
                return (
                  <div
                    key={cell.iso}
                    className={`border-edge min-h-16 border-r p-0.5 last:border-r-0 ${
                      cell.inMonth
                        ? holiday
                          ? "bg-attn-soft"
                          : cell.isWeekend
                            ? "bg-sunk"
                            : ""
                        : "opacity-40"
                    } ${
                      // Spec 404 U2 — which of 42 cells the docked panel is
                      // about. A ring rather than a fill, so it reads on top of
                      // the holiday and weekend tints instead of replacing them.
                      isOpenFix ? "ring-action ring-2 ring-inset" : ""
                    }`}
                  >
                    {fixTo ? (
                      // The whole cell is the target: on a tablet — the device the
                      // operator asked about — a 10px day number is not a usable
                      // one. `block h-full` so the tap area is the cell rather
                      // than just the text it wraps.
                      //
                      // ⚠️ NO author-supplied aria-label. An aria-label on a link
                      // REPLACES its subtree as the accessible name, so
                      // `แก้ไขการเช็คชื่อ 15 ก.ค.` would silently drop the
                      // check-in/out times, +1 วัน, (อัตโนมัติ), the OT hours,
                      // บันทึกมือ, ทำงานวันหยุด, the holiday name and the
                      // off-home project — leaving the roles that GOT the control
                      // hearing strictly less than the roles that did not. That is
                      // the U3b <th> defect verbatim, and an earlier draft of this
                      // very cell shipped it.
                      //
                      // ⚠️ And spec 404 U2 removed the `title` too. It carried
                      // the link's whole PURPOSE and was justified as "desktop
                      // back-office, where hover is real" — false on the iPad
                      // this page is read on. The purpose is now carried by the
                      // panel's own heading, which appears the moment the cell
                      // is tapped, because the cell opens it IN PLACE.
                      <Link
                        href={fixTo}
                        aria-current={isOpenFix ? "date" : undefined}
                        className="focus-visible:ring-action block h-full rounded focus:outline-none focus-visible:ring-2"
                      >
                        {inner}
                        {/* The link's PURPOSE, ADDED to the subtree rather than
                            replacing it. Removing the `title` left the name as
                            bare facts — `15 07:30–17:00` never says this is a
                            control or what activating it does, which is the
                            before-activation question a `title` was (badly)
                            answering. An `sr-only` span keeps every fact AND
                            names the act; an `aria-label` would replace the
                            whole subtree, which is the U6b defect.

                            ⚠️ Spec 404 U2b — a BLANK door does NOT say
                            เพิ่มคนที่ตกหล่น, and the first draft did. There is
                            no เช็คชื่อ on that day to แก้ไข, so the data door's
                            wording is wrong for it — but naming the add form is
                            wrong too, because the panel withholds that form on a
                            CLOSED day (`dayClosed === false` gates the whole
                            block) and offers เปิดวันอีกครั้ง instead. That is not
                            an edge: all 13 past days carrying attendance are
                            closed, and 2026-08-04 — the live case this door was
                            built for — is one of them, so the promise would have
                            been false for the flagship example. The link names
                            the thing it actually does, which is true whether the
                            day is open or closed; the panel's own heading states
                            what is offered once it is open. */}
                        <span className="sr-only">
                          {data ? "แก้ไขการเช็คชื่อ" : "เปิดหน้าต่างแก้ไข"}
                        </span>
                      </Link>
                    ) : (
                      inner
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Spec 404 U2 — the words the compact cell gave up ──────────────
            Rendered per marker, and only when the month actually carries it: an
            always-on legend is wallpaper, and a reader who never meets a glyph
            does not need it explained. */}
        {(hasAutoOut || hasNextDayOut || holidayEntries.length > 0) && (
          <div className="text-ink-secondary flex flex-col gap-1 text-xs">
            {hasAutoOut && (
              <p>
                <Timer aria-hidden className="mr-1 inline-block h-3 w-3 align-middle" />
                {AUTO_OUT_LEGEND}
              </p>
            )}
            {hasNextDayOut && <p>+1 — {NEXT_DAY_LEGEND}</p>}
            {holidayEntries.length > 0 && (
              // The full name, for every reader on every device — this is what
              // replaces the `title=` the cell used to hide it behind.
              <ul aria-label="วันหยุดของเดือนนี้" className="flex flex-col gap-0.5">
                {holidayEntries.map(([iso, name]) => (
                  <li key={iso}>
                    <span className="text-attn-ink font-medium">{Number(iso.slice(8, 10))}</span>{" "}
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
