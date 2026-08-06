// Spec 358 U2 — ประวัติการเช็คชื่อ: the office/payroll attendance AUDIT report.
//
// The muster cockpit answers "who is here TODAY" and is hard-locked to today's
// date; nothing answered "who was present over this month, and does the record
// look trustworthy". This page does, cross-project, for the office audience.
//
// Server Component. The ATTENDANCE read goes through `audit_attendance_summary`,
// a DEFINER RPC, on the RLS SESSION client — never the admin client: calling it
// under the user's JWT is what makes its role gate AND its can_see_project scoping
// (for project_manager) apply. muster_* RLS is can_see_project-scoped, which is
// FALSE for accounting/hr, which is why the RPC exists at all.
//
// The one admin-client read is the project PICKER's options, and only for the
// cross-project tier — see the comment at that call for why the session client
// cannot serve it. No attendance row, and no money, ever comes from admin here.
//
// RAW scan truth: presence, OT hours, and the audit signals. NO wages, no GL, no
// baht anywhere on this surface (spec 306 U5 owns the money derive). Period is a
// zero-client-JS GET form, the /payroll + /requests house pattern.

import Link from "next/link";
import { PageShell } from "@/components/features/chrome/page-shell";
import { AttendanceDrill } from "@/components/features/muster/attendance-drill";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { attendanceBackLabel, safeBackHref } from "@/lib/nav/back-href";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import {
  ATTENDANCE_AUDIT_ALL_PROJECT_ROLES,
  ATTENDANCE_AUDIT_ROLES,
  MUSTER_REOPEN_ROLES,
  SA_SURFACE_ROLES,
  WORKER_ROSTER_ROLES,
} from "@/lib/auth/role-home";
import { AttendanceGridView } from "@/components/features/muster/attendance-grid-view";
import { attendanceView, buildAttendanceGrid, gridWorkerHref } from "@/lib/muster/attendance-grid";
import { createClient as createServerClient } from "@/lib/db/server";
import { createClient as createAdminClient } from "@/lib/db/admin";
import {
  SECTION_HEADING,
  CARD,
  FIELD_INPUT,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
} from "@/lib/ui/classes";
import { bangkokTodayIso } from "@/lib/dates";
import { ATTENDANCE_AUDIT_LABEL, formatThaiDate } from "@/lib/i18n/labels";
import {
  attendanceRange,
  attendanceWorkerId,
  formatSignals,
  groupDetailByDate,
  loadAttendanceDetail,
  loadAttendanceSummary,
  unclosedDaySignal,
} from "@/lib/muster/attendance-audit";

export const metadata = { title: ATTENDANCE_AUDIT_LABEL };

function formatNumber(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 1 });
}

// Spec 397 U3 — the reopen outcome codes, in the app's own words. No "ลองใหม่" in
// any of them: `denied` and `shape` can never succeed on a retry, `wages` and
// `notclosed` describe a state the reader must act on first, and `failed` is of
// unknown retryability — so each names the cause and the next step instead.
const REOPEN_ERROR_COPY: Record<string, string> = {
  denied: "บัญชีนี้ไม่มีสิทธิ์เปิดวันที่ปิดแล้ว",
  wages: "วันนี้บันทึกค่าแรงไปแล้ว ต้องยกเลิกค่าแรงก่อนจึงจะเปิดวันใหม่ได้",
  notclosed: "วันนี้ยังไม่ได้ปิด จึงไม่ต้องเปิดใหม่",
  shape: "วันที่หรือโครงการไม่ถูกต้อง และต้องระบุเหตุผลด้วย",
  failed: "เปิดวันอีกครั้งไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบพร้อมวันที่และชื่อโครงการ",
};

interface AttendanceAuditPageProps {
  // ?start/?end = the audit range; ?from = the back-referrer (this page hangs off
  // /team, /accounting AND — since spec 397 U2 — /procurement, so the parent is
  // not derivable: the spec-334 multi-parent pattern, and the same param split
  // /payroll settled on).
  searchParams: Promise<{
    start?: string | string[];
    end?: string | string[];
    project?: string | string[];
    from?: string | string[];
    /** Spec 397 U3 — the reopen form's outcome, carried back by its redirect. */
    reopened?: string | string[];
    reopenError?: string | string[];
    // U3 — expand ONE worker's per-session rows.
    worker?: string | string[];
    /** Spec 400 U1 — `grid` (default) or `list`. */
    view?: string | string[];
  }>;
}

export default async function AttendanceAuditPage({ searchParams }: AttendanceAuditPageProps) {
  const ctx = await requireRole(ATTENDANCE_AUDIT_ROLES);
  const { start, end, project, from, worker, reopened, reopenError, view } = await searchParams;
  const shape = attendanceView(view);
  const todayIso = bangkokTodayIso();
  const range = attendanceRange({ start, end, project }, todayIso);
  // Mid-shift open check-outs are expected (no auto-out cron), so the chip wording
  // softens whenever the range reaches today — see formatSignals.
  const rangeIncludesToday = range.to >= todayIso;
  // Multi-parent chip: resolve the href FIRST, then label it for where it actually
  // goes. A fixed "ทีมงาน" label is the aria-label a screen reader hears, so on an
  // /accounting referral it would announce the wrong destination. Spec 397 U2 made
  // /procurement a third parent and moved the naming into attendanceBackLabel, so
  // adding a parent is a one-line change beside safeBackHref, not a wider ternary.
  const backHref = safeBackHref(from, "/team");
  const backLabel = attendanceBackLabel(backHref);
  // Spec 397 U3 — whether the VIEWER can finish the loop themselves.
  // SA_SURFACE_ROLES is exactly `close_muster_day`'s live allowlist (verified),
  // and plain `procurement` is not in it (nor does it pass that RPC's
  // can_see_project), so for the very role this spec is about the loop is
  // two-person. The copy must say that rather than name a step it cannot take.
  const canClose = SA_SURFACE_ROLES.includes(ctx.role);

  const supabase = await createServerClient();
  const rows = await loadAttendanceSummary(supabase, range);

  // Project options for the picker. The read client is chosen per TIER, mirroring
  // the RPCs' own two tiers, because `projects` SELECT runs on can_see_project:
  // that is FALSE for accounting/hr, so a session-client read hands them ZERO rows
  // (probed live) — an empty dropdown on a report that legitimately spans every
  // project. The cross-project tier therefore reads options via admin (no new
  // exposure: the RPC already returns them every project's attendance), while
  // project_manager keeps the SESSION read so RLS scopes options to exactly its
  // memberships — matching the rows the RPC will actually return for it.
  //
  // Spec 397 U1 note: `procurement` joined the cross-project tier for the RPC arm,
  // NOT because it needs this bypass — the live `projects` SELECT policy already
  // reads `current_user_role() = any('{procurement,procurement_manager}') or
  // can_see_project(id)`, so a session read would return every project for it too.
  // The tier branch is therefore a no-op for that role today; if `projects` RLS is
  // ever narrowed, this comment is the reason the picker would not notice.
  const seesAllProjects = ATTENDANCE_AUDIT_ALL_PROJECT_ROLES.includes(ctx.role);
  const projectReader = seesAllProjects ? createAdminClient() : supabase;
  const { data: projectOptions } = await projectReader
    .from("projects")
    .select("id, code, name")
    .order("code");

  // Spec 400 U1 — the GRID reads the same DEFINER RPC as the CSV export does,
  // with no p_worker_id, so it inherits the report's role gate and its
  // can_see_project scoping unchanged. Holidays come off the SESSION client:
  // `public_holidays` RLS is `readable by authenticated` with qual `true`
  // (verified live), so no admin seam is needed to shade a column.
  //
  // The range is capped (MAX_GRID_DAYS) because ?start is validated for calendar
  // validity, not span — so the fetch is SKIPPED for a too-wide range rather than
  // pulling every session since 2020 to then refuse to draw it.
  const gridProbe = buildAttendanceGrid({ ...range, rows: [], todayIso });
  const gridDetail =
    shape === "grid" && !gridProbe.tooWide ? await loadAttendanceDetail(supabase, range, null) : [];
  const { data: holidays } =
    shape === "grid" && !gridProbe.tooWide
      ? await supabase
          .from("public_holidays")
          .select("holiday_date, name_th")
          .gte("holiday_date", range.from)
          .lte("holiday_date", range.to)
      : { data: null };
  const grid = buildAttendanceGrid({
    ...range,
    rows: gridDetail,
    holidays: holidays ?? [],
    todayIso,
  });

  const totalDays = rows.reduce((sum, r) => sum + r.daysPresent, 0);
  const totalOt = rows.reduce((sum, r) => sum + r.otHoursTotal, 0);
  const unclosedDays = unclosedDaySignal(rows);

  // U3 — the drill. `?worker=<id>` expands ONE worker's per-session rows; the
  // detail RPC is only called for that worker, so the default view stays a single
  // summary query. The id is validated the same way ?project is: an unvalidated
  // uuid would reach SQL as 22P02 and dead-end on the error boundary.
  const openWorkerId = attendanceWorkerId(
    worker,
    rows.map((r) => r.workerId),
  );
  const detailDays = openWorkerId
    ? groupDetailByDate(await loadAttendanceDetail(supabase, range, openWorkerId))
    : [];

  // U4 — the export link mirrors the CURRENT range + project so the file is
  // exactly what the viewer sees. No ?worker: the export is always every worker in
  // scope, and no ?from (the route has no chrome).
  const exportHref = (() => {
    const q = new URLSearchParams({ start: range.from, end: range.to });
    if (range.projectId) q.set("project", range.projectId);
    return `/team/attendance/export?${q.toString()}`;
  })();

  // Spec 400 U1 — the two views of the same range. GRID is the default, so its
  // href carries no ?view at all: a bookmark made today keeps working if the
  // default ever moves, and the URL stays the short one.
  const viewHref = (target: "grid" | "list"): string => {
    const q = new URLSearchParams({ start: range.from, end: range.to });
    if (range.projectId) q.set("project", range.projectId);
    if (backHref !== "/team") q.set("from", backHref);
    if (target === "list") q.set("view", "list");
    return `/team/attendance?${q.toString()}`;
  };

  // Spec 400 D9 — a worker name in the grid goes wherever that ROLE can actually
  // land. WORKER_ROSTER_ROLES is narrower than ATTENDANCE_AUDIT_ROLES, so
  // accounting / hr / project_coordinator would meet a redirect at the spec-374
  // calendar; they get this report's own drill instead, which they can open. The
  // affordance is therefore never withheld, only re-aimed.
  const canOpenCalendar = WORKER_ROSTER_ROLES.includes(ctx.role);
  const workerHref = (workerId: string): string =>
    gridWorkerHref({ workerId, canOpenCalendar, range, backHref });

  // Preserve the range + project + referrer when toggling a drill open/closed.
  const drillHref = (workerId: string | null): string => {
    const q = new URLSearchParams({ start: range.from, end: range.to });
    if (range.projectId) q.set("project", range.projectId);
    if (backHref !== "/team") q.set("from", backHref);
    if (workerId) q.set("worker", workerId);
    // Spec 400 U1 — the drill lives in the LIST view, so its own links must keep
    // that view. Without this, opening a row would silently switch the reader
    // back to the default grid and the drill they asked for would not be there.
    q.set("view", "list");
    // Fragment so toggling a row keeps that row in view (a server navigation
    // otherwise re-renders scrolled to the top and the user hunts for it again).
    return `/team/attendance?${q.toString()}#w-${workerId ?? openWorkerId ?? ""}`;
  };

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={backHref} backLabel={backLabel}>
        <h1 className="text-title text-ink font-bold tracking-tight">{ATTENDANCE_AUDIT_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>{ATTENDANCE_AUDIT_LABEL}</h2>

        {/* Period + project — zero-client-JS GET form, defaults to this month. */}
        <form
          method="get"
          className={`${CARD} mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end`}
        >
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ตั้งแต่
            <input
              type="date"
              name="start"
              defaultValue={range.from}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            ถึง
            <input
              type="date"
              name="end"
              defaultValue={range.to}
              className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
            />
          </label>
          <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
            โครงการ
            <select
              name="project"
              defaultValue={range.projectId ?? ""}
              className={`${FIELD_INPUT} mt-1 max-w-full`}
            >
              <option value="">ทุกโครงการ</option>
              {projectOptions?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code ? `${p.code} · ${p.name}` : p.name}
                </option>
              ))}
            </select>
          </label>
          {/* Carry the referrer THROUGH the submit. Without this the GET form
              rebuilds the URL from its own fields only, dropping ?from — so an
              accounting user who changes the range would find the back chip
              pointing at /team, a place they never came from. */}
          {backHref !== "/team" && <input type="hidden" name="from" value={backHref} />}
          {/* Same reason as ?from: a GET form rebuilds the URL from its own
              fields, so without this a reader who changed the range while in the
              LIST view would be thrown back to the default grid. */}
          {shape === "list" && <input type="hidden" name="view" value="list" />}
          <button type="submit" className={BUTTON_PRIMARY}>
            ดูข้อมูล
          </button>
        </form>

        {/* Spec 397 U3 — the reopen form redirects back here with its outcome as a
            CODE, and this page owns the copy (a Thai sentence in the URL would be
            unbounded and forgeable). Success states what is now TRUE rather than
            "done", and it is role-aware: `close_muster_day` refuses plain
            procurement, so telling that role to close the day again would name a
            step it cannot take (§9 Q7). */}
        {typeof reopenError === "string" && reopenError.length > 0 && (
          <div className="mb-4">
            <ErrorNotice>{REOPEN_ERROR_COPY[reopenError] ?? REOPEN_ERROR_COPY.failed}</ErrorNotice>
          </div>
        )}
        {reopened === "1" && (
          <p className="border-edge bg-sunk text-ink rounded-card mb-4 border px-4 py-3 text-sm">
            {canClose
              ? "เปิดวันนี้อีกครั้งแล้ว — แก้ไขการเช็คชื่อได้ และต้องปิดวันใหม่เมื่อแก้เสร็จ"
              : "เปิดวันนี้อีกครั้งแล้ว — แจ้ง SA ให้แก้ไขการเช็คชื่อและปิดวันใหม่ ค่าแรงจึงจะถูกคิดใหม่"}
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyNotice>ไม่มีบันทึกการเช็คชื่อในช่วงนี้</EmptyNotice>
        ) : (
          <>
            <div className={`${CARD} mb-4`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-ink-secondary text-xs">
                  {formatThaiDate(range.from)} – {formatThaiDate(range.to)}
                </p>
                {/* U4 — the payroll hand-off. Carries the CURRENT range + project.
                    Plain <a download>, NOT next/link — a prefetch must not fire the
                    export route (spec 69 / ADR 0012; verified: a prefetch request
                    DOES reach the handler and would build the whole CSV unclicked).
                    Labelled ทุกคน because it always exports every worker in scope,
                    even while one worker's drill is open on screen.
                    BUTTON_SECONDARY matches the /payroll + /requests exports. */}
                <a href={exportHref} download className={`${BUTTON_SECONDARY} shrink-0`}>
                  ดาวน์โหลด CSV (ทุกคน)
                </a>
              </div>
              <p className="text-ink mt-1 text-sm font-semibold">
                {rows.length} คน · รวม {formatNumber(totalDays)} วัน
                {totalOt > 0 ? ` · OT ${formatNumber(totalOt)} ชม.` : ""}
              </p>
              {/* The unclosed-day count is a PROJECT-day fact, identical for every
                  worker of that day — so it belongs here ONCE, not as a chip on
                  each worker row (which read as N findings against N people). It
                  is why the spec-306 wage derive cannot fire for those days. */}
              {unclosedDays > 0 && (
                <p className="text-ink-secondary mt-1 text-xs">
                  {unclosedDays} วันที่ยังไม่ได้ปิด — ค่าแรงของวันนั้นยังไม่ถูกบันทึก
                </p>
              )}
              {/* Spec 400 U1 — the two shapes of the same range. The list is NOT
                  retired: it is the better read for one person's month and it is
                  what the CSV mirrors, so the grid is a default, not a
                  replacement. aria-current marks the live one for a reader. */}
              <div className="border-edge mt-3 flex gap-2 border-t pt-3">
                {(["grid", "list"] as const).map((target) => {
                  const isCurrent = shape === target;
                  return (
                    <Link
                      key={target}
                      href={viewHref(target)}
                      aria-current={isCurrent ? "page" : undefined}
                      className={`inline-flex min-h-11 items-center rounded-full px-3 text-xs ${
                        isCurrent
                          ? "bg-action-soft text-action font-semibold"
                          : "text-ink-secondary hover:underline"
                      }`}
                    >
                      {target === "grid" ? "ตาราง" : "รายการ"}
                    </Link>
                  );
                })}
              </div>
            </div>

            {shape === "grid" && (
              <AttendanceGridView grid={grid} todayIso={todayIso} workerHref={workerHref} />
            )}

            {/* One row per worker. The signal chips mark the rows an auditor
                should look at — a clean row carries none. Each name opens the
                per-day drill (U3), which turns those COUNTS into the actual
                sessions behind them. */}
            {shape === "list" && (
              <ul className="flex flex-col gap-2">
                {rows.map((r) => {
                  const signals = formatSignals(r, { rangeIncludesToday });
                  const isOpen = r.workerId === openWorkerId;
                  return (
                    <li key={r.workerId} id={`w-${r.workerId}`} className={CARD}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        {/* text-action + inline-flex items-center is the house link
                          idiom (globals.css reserves --color-action for links).
                          Styling it like the surrounding text left the drill
                          invisible on touch, where hover:underline never fires —
                          an undiscoverable feature ships to zero usage. */}
                        <Link
                          href={drillHref(isOpen ? null : r.workerId)}
                          className="text-action focus-visible:ring-action inline-flex min-h-11 min-w-0 items-center rounded text-sm font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
                        >
                          {r.workerName}
                          <span className="text-ink-secondary ml-1 text-xs font-normal">
                            {isOpen ? "▾" : "▸"}
                          </span>
                        </Link>
                        <span className="text-ink-secondary text-xs">
                          {r.daysPresent} วัน
                          {r.otHoursTotal > 0 ? ` · OT ${formatNumber(r.otHoursTotal)} ชม.` : ""}
                          {r.projectCount > 1 ? ` · ${r.projectCount} โครงการ` : ""}
                        </span>
                      </div>
                      {signals.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5">
                          {signals.map((s) => (
                            <li
                              key={s.key}
                              className="bg-sunk text-ink-secondary rounded-full px-2 py-0.5 text-[11px]"
                            >
                              {s.label}
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* U3 — the drill. Per DAY (newest first), regular before OT,
                        with the facts behind the summary's counts: the actual
                        times, how each scan was recorded, whether the system
                        auto-closed it, and who recorded it. Closure sits on the
                        DAY header, not the session (it is a project-day fact). */}
                      {isOpen && (
                        <div className="border-edge mt-3 border-t pt-3">
                          {/* Spec 397 U3 — the reopen control rides the day header.
                            canReopen mirrors reopen_muster_day's own allowlist, so
                            the button can never promise what the RPC refuses;
                            drillHref(openWorkerId) is the URL the form returns to,
                            so the outcome lands on the SAME open drill. */}
                          <AttendanceDrill
                            days={detailDays}
                            todayIso={todayIso}
                            canReopen={MUSTER_REOPEN_ROLES.includes(ctx.role)}
                            canClose={canClose}
                            backHref={drillHref(r.workerId)}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </PageShell>
  );
}
