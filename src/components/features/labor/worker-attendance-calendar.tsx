// Spec 374 U1 — the per-worker attendance month calendar (ปฏิทินเข้างาน).
// Pure presentational and server-renderable: the page loads + builds the
// month, this renders it. Three blocks: worker header (rate + info), month
// summary (scanned / OT / estimate / paid variance + the cost-unconfirmed
// explainer), and the muster day grid. Month steppers are plain links so the
// whole surface stays a Server Component.

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

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

export function WorkerAttendanceCalendar({
  month,
  worker,
  stdRate,
  prevHref,
  nextHref,
  dayFixHref = null,
}: {
  month: AttendanceMonth;
  worker: AttendanceWorkerHeader;
  /** Standard gross rate for the worker's level — null when unset OR when the
   *  viewer is outside the /settings/labor-rates money audience. */
  stdRate: number | null;
  prevHref: string;
  nextHref: string;
  /**
   * Spec 400 U6b — a day cell's link to that worker-day's fix screen (U6a).
   *
   * `null` for every reader outside MUSTER_CORRECT_ROLES. This page's own gate is
   * WORKER_ROSTER_ROLES, which includes project_manager and project_director —
   * both refused by every correction RPC with 42501 — so the link is withheld
   * from them while every fact in the cell stays.
   *
   * Only days that CARRY attendance link: the fix screen resolves its project
   * from the first session, and this calendar holds `projectName` but no project
   * id, so an empty day has nothing to resolve from and would land on the page's
   * `noProject` arm.
   */
  dayFixHref?: ((date: string) => string) | null;
}) {
  const { summary } = month;
  const showStd = stdRate !== null && stdRate !== worker.dayRate;

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
          {worker.projectLabel ? (
            <div className="flex gap-2">
              <dt className="font-medium">โครงการ</dt>
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
          <span className="text-ink-secondary text-xs"> (จำนวนวัน × ค่าแรง/วัน)</span>
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
                // Spec 400 U6b — a day with attendance is a door. `data` is the
                // gate on purpose: it is exactly "this date has something to
                // correct", and it is also what guarantees the fix screen can
                // infer a project. Padding cells (`inMonth === false`) resolve
                // `data` to undefined, so they never link.
                const fixTo = data && dayFixHref ? dayFixHref(cell.iso) : null;
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
                      // title: long royal-holiday names truncate at cell width;
                      // this page's audience is desktop back-office, where
                      // hover is real (unlike the gloved-hand PWA surfaces).
                      <p
                        title={holiday}
                        className="text-attn-ink truncate text-[10px] leading-tight"
                      >
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
                    {data ? (
                      <div className="text-ink-secondary text-[10px] leading-tight">
                        {data.inTime ? <p>{data.inTime}</p> : null}
                        {data.outTime ? (
                          <p>
                            {data.outTime}
                            {/* Marker copy mirrors the /team/attendance drill:
                                (+1 วัน) for a post-midnight out, (อัตโนมัติ)
                                for the close-day auto-out. */}
                            {data.outNextDay ? (
                              <span className="text-ink-muted"> (+1 วัน)</span>
                            ) : null}
                            {data.outAuto ? (
                              <span className="text-ink-muted"> (อัตโนมัติ)</span>
                            ) : null}
                          </p>
                        ) : null}
                        {data.otHours > 0 ? (
                          <p className="text-attn-ink font-medium">+{fmtDays(data.otHours)} ชม.</p>
                        ) : null}
                        {data.inMethod === "manual" || data.outMethod === "manual" ? (
                          <p className="text-ink-muted">บันทึกมือ</p>
                        ) : null}
                        {data.projectName && data.projectName !== worker.projectLabel ? (
                          <p className="text-ink-muted font-medium">
                            {data.projectName.split(" ")[0]}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                );
                return (
                  <div
                    key={cell.iso}
                    className={`border-edge min-h-16 border-r p-1 last:border-r-0 ${
                      cell.inMonth
                        ? holiday
                          ? "bg-attn-soft"
                          : cell.isWeekend
                            ? "bg-sunk"
                            : ""
                        : "opacity-40"
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
                      // check-in/out times, (+1 วัน), (อัตโนมัติ), the OT hours,
                      // บันทึกมือ, ทำงานวันหยุด, the holiday name and the
                      // off-home project — leaving the roles that GOT the control
                      // hearing strictly less than the roles that did not. That is
                      // the U3b <th> defect verbatim, and an earlier draft of this
                      // very cell shipped it. The subtree already names the day and
                      // every fact; `title` supplies the act without touching the
                      // name (this page's audience is desktop/tablet back-office,
                      // where the existing holiday <p> already relies on hover).
                      <Link
                        href={fixTo}
                        title={`แก้ไขการเช็คชื่อ ${cell.day} ${month.grid.label}`}
                        className="focus-visible:ring-action block h-full rounded focus:outline-none focus-visible:ring-2"
                      >
                        {inner}
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
      </section>
    </div>
  );
}
