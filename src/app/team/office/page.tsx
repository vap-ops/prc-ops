// Spec 397 U5 — ทีมสำนักงาน, the office team's own surface.
//
// The operator's second ask was that the site office team can take their own
// attendance. U4 made an office team expressible; this is where it becomes usable:
// open today's team, see who is in, add someone, check them out.
//
// It is NOT part of the muster cockpit. That board groups by หัวหน้าชุด and
// deliberately excludes office teams (U4), so an office section there would render
// a headless group. A separate surface also keeps the crew's วันนี้ numbers
// untouched, which is what the SA reads every morning.
//
// Zero client JS, matching /team/attendance: POST forms + a redirect carrying an
// outcome code. Nothing to hydrate — and it therefore works on the in-app browser,
// where hydration does not run.
//
// Gate is SA_SURFACE_ROLES: exactly the set every muster write RPC admits
// (site_admin, super_admin, procurement_manager), so no control here can promise
// what the server refuses.

import Link from "next/link";

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";
import { HelpCard } from "@/components/features/sa/help/help-card";
import { requireRole } from "@/lib/auth/require-role";
import { SA_SURFACE_ROLES, WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";
import { bangkokTodayIso } from "@/lib/dates";
import { createClient } from "@/lib/db/server";
import {
  formatThaiDate,
  OFFICE_TEAM_LABEL,
  USER_ROLE_LABEL,
  WORKER_ROSTER_LABEL,
} from "@/lib/i18n/labels";
import { loadOfficeBoard } from "@/lib/muster/office-board";
import { safeBackHref } from "@/lib/nav/back-href";
import { getSaCurrentProject } from "@/lib/sa/current-project.server";
import { OFFICE_ATTENDANCE_HELP } from "@/lib/sa/help-content";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  CARD,
  FIELD_INPUT,
  SECTION_HEADING,
} from "@/lib/ui/classes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

import {
  addOfficeMember,
  checkOutOfficeMember,
  openOfficeTeam,
  removeOfficeMember,
} from "./actions";

export const metadata = { title: OFFICE_TEAM_LABEL };

// The page owns EVERY string; the action returns a code (see actions.ts — the
// first cut put the Thai in the URL and rendered it, which is in-app spoofing).
// No "ลองใหม่" in any failure arm: `denied` and `alreadyin` can never succeed on a
// retry, and `failed` is of unknown retryability, so each names the cause instead.
const OUTCOME_COPY: Record<string, string> = {
  opened: "เปิดทีมสำนักงานของวันนี้แล้ว",
  added: "บันทึกเวลาเข้างานแล้ว",
  out: "บันทึกเวลาออกงานแล้ว",
  removed: "เอารายการออกแล้ว",
};

const FAILURE_COPY: Record<string, string> = {
  denied: "บัญชีนี้ไม่มีสิทธิ์จัดการทีมสำนักงาน",
  alreadyin: "คนนี้เช็คชื่อในทีมอื่นแล้ววันนี้ ต้องเอาออกจากทีมนั้นก่อน",
  failed: "ทำรายการไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบพร้อมชื่อและเวลา",
};

function time(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

export default async function OfficeTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; o?: string | string[] }>;
}) {
  const ctx = await requireRole(SA_SURFACE_ROLES);
  const { from, o } = await searchParams;
  const backHref = safeBackHref(from, "/team");
  const today = bangkokTodayIso();

  const supabase = await createClient();
  // `current` carries only the id + how it was resolved; the NAME lives on the
  // visible-project rows, which the same call returns.
  const { current, visibleProjects } = await getSaCurrentProject(supabase, ctx.id);
  const project = visibleProjects.find((p) => p.id === current.projectId) ?? null;

  // No project to attend: say so rather than rendering an open-team button that
  // cannot work (the RPC needs a project).
  if (!project) {
    return (
      <PageShell>
        <BottomTabBar role={ctx.role} />
        <DetailHeader backHref={backHref} backLabel="ทีมงาน">
          <h1 className="text-title text-ink font-bold tracking-tight">{OFFICE_TEAM_LABEL}</h1>
        </DetailHeader>
        <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
          <EmptyNotice>ยังไม่มีโครงการที่ดูแล</EmptyNotice>
        </section>
      </PageShell>
    );
  }

  const board = await loadOfficeBoard(supabase, project.id, today);
  const teamId = board.teamId;
  const outcome = typeof o === "string" ? o : null;
  const failure = outcome ? (FAILURE_COPY[outcome] ?? null) : null;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={backHref} backLabel="ทีมงาน">
        <h1 className="text-title text-ink font-bold tracking-tight">{OFFICE_TEAM_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-xs">
          {project.name} · {formatThaiDate(today)}
        </p>

        {failure && <ErrorNotice>{failure}</ErrorNotice>}
        {outcome && OUTCOME_COPY[outcome] && (
          <p className="border-edge bg-sunk text-ink rounded-card border px-4 py-3 text-sm">
            {OUTCOME_COPY[outcome]}
          </p>
        )}

        {/* Spec 397 U6 — the teaching half, rendered OUTSIDE the open/not-open
            split: the state a first-timer is in every morning is the one where
            today's team is not open yet, so a guide inside either arm would miss
            half its readers. OPEN until today's team exists and collapsed after —
            a bare <details> is shut, so parking the guide here without that would
            teach nobody. Native <details>, zero JS: this page hydrates nothing.
            Same card object the คู่มือ hub renders, because `/sa/help` sees ~4
            views a month and this page is where the task is. */}
        <HelpCard card={OFFICE_ATTENDANCE_HELP} open={teamId === null} />

        {teamId === null ? (
          <div className={CARD}>
            <h2 className={SECTION_HEADING}>ยังไม่ได้เปิด{OFFICE_TEAM_LABEL}วันนี้</h2>
            <p className="text-ink-secondary mt-1 text-sm">
              เปิดแล้วจึงจะบันทึกเวลาเข้า–ออกของทีมสำนักงานได้
              ทีมนี้ไม่ขึ้นในกระดานเช็คชื่อของทีมช่าง
            </p>
            <form action={openOfficeTeam} className="mt-3">
              <input type="hidden" name="projectId" value={project.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                เปิดทีมสำนักงาน
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className={CARD}>
              <p className="text-ink text-lg font-bold">
                {board.presentCount === 0
                  ? "ยังไม่มีใครเช็คชื่อ"
                  : `เช็คชื่อแล้ว ${board.presentCount} คน`}
                {board.stillInCount > 0 ? ` · ยังอยู่ ${board.stillInCount} คน` : ""}
              </p>
            </div>

            {board.members.length > 0 && (
              <ul className="flex flex-col gap-2">
                {board.members.map((mem) => (
                  <li
                    key={mem.workerId}
                    className={`${CARD} flex flex-wrap items-center gap-x-3 gap-y-2`}
                  >
                    <span className="text-ink min-w-[8rem] flex-1 truncate text-sm font-medium">
                      {mem.name}
                    </span>
                    <span className="text-ink-secondary shrink-0 text-xs">
                      เข้า {time(mem.inAt)}
                      {mem.outAt ? ` · ออก ${time(mem.outAt)}` : ""}
                    </span>
                    {/* Only someone still in can be checked out — the RPC refuses a
                        second check-out, so the control disappears instead of
                        offering a tap that fails. */}
                    {mem.outAt === null && (
                      <form action={checkOutOfficeMember} className="shrink-0">
                        <input type="hidden" name="teamId" value={teamId} />
                        <input type="hidden" name="workerId" value={mem.workerId} />
                        <button type="submit" className={BUTTON_SECONDARY}>
                          ออกงาน
                        </button>
                      </form>
                    )}
                    {/* The escape hatch, and it is not optional: a wrong person
                        added here has their real crew check-in refused all day,
                        and if the day is closed they lose that day's wage
                        (the office team binds no WP, so derive books nothing).
                        Checking out only stamps a time — it does not undo the
                        mistake — and the cockpit's undo cannot see office rows. */}
                    <form action={removeOfficeMember} className="shrink-0">
                      <input type="hidden" name="workerId" value={mem.workerId} />
                      <button
                        type="submit"
                        className="text-ink-secondary hover:text-ink focus-visible:ring-action inline-flex min-h-11 items-center rounded px-2 text-xs underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2"
                      >
                        เอาออก
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <div className={CARD}>
              <h2 className={SECTION_HEADING}>เพิ่มคนเข้าทีมสำนักงาน</h2>
              {/* Two DIFFERENT states, and the same sentence would be false for
                  one of them: before U6 creates the office worker rows the roster
                  is simply empty, and saying "everyone has checked in" beside
                  "nobody has checked in" is a self-contradiction the reader
                  cannot resolve. */}
              {board.rosterSize === 0 ? (
                /* Spec 397 U6 — role-aware, and that is not a nicety: `/workers`
                   is gated on WORKER_ROSTER_ROLES, which does NOT include
                   site_admin — this page's primary audience. U5's sentence sent
                   them to a route that redirects them (U3's 🔴 #2, shipped
                   again). Each arm names the step ITS reader can actually take. */
                <p className="text-ink-secondary mt-1 text-sm">
                  ยังไม่มีรายชื่อทีมสำนักงานในโครงการนี้ —{" "}
                  {WORKER_ROSTER_ROLES.includes(ctx.role) ? (
                    <>
                      เพิ่มได้ที่{" "}
                      <Link href="/workers" className="text-action underline underline-offset-2">
                        {WORKER_ROSTER_LABEL}
                      </Link>{" "}
                      โดยเลือก การจ่าย = รายเดือน แล้วเลือกโครงการนี้
                    </>
                  ) : (
                    <>
                      แจ้ง{USER_ROLE_LABEL.project_manager}หรือ{USER_ROLE_LABEL.procurement}
                      ให้เพิ่มรายชื่อ (การจ่าย = รายเดือน) ในโครงการนี้ก่อน
                    </>
                  )}
                </p>
              ) : board.addable.length === 0 ? (
                <p className="text-ink-secondary mt-1 text-sm">
                  ทุกคนในทีมสำนักงานเช็คชื่อแล้ววันนี้
                </p>
              ) : (
                <form action={addOfficeMember} className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="teamId" value={teamId} />
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">เลือกคน</span>
                    <select name="workerId" required className={`${FIELD_INPUT} max-w-full`}>
                      {board.addable.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={`${BUTTON_PRIMARY} shrink-0`}>
                    บันทึกเข้างาน
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </section>
    </PageShell>
  );
}
