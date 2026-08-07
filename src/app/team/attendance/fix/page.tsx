// Spec 400 U6a — the worker-day fix screen: retime, add or delete ONE person's
// attendance for ONE day, without opening the 42-row grid or the day panel.
// Design ratified with the operator over three widget revisions in chat before
// build (memory spec400-attendance-grid.md, "U6 PLAN, rev 3") — do not
// re-litigate the shape here:
//
//   - NO wizard / step strip. Gates are PER ACTION, measured from the live RPC
//     bodies: retime (`muster_correct_session`'s UPDATE path) works even on a
//     CLOSED day — its own guard is the unbooked-wage anti-join, built for the
//     nine 2026-07-24 OT rows, not the day's closure state. Add (the INSERT
//     path) and delete (`muster_undo_scan`) both require the day OPEN, so they
//     sit under ONE locked group whose header carries the reopen form, rather
//     than repeating the same gate on two separate cards.
//   - No time field ever has a default value: a wrong guessed timestamp is
//     worse than an empty one forcing a real value (U4's own rule).
//   - The trail is the SAME `list_muster_day_audit` RPC the day panel reads,
//     filtered in TypeScript to just this worker_id.
//
// Server Component, ZERO client JS: every control here is a plain POST form +
// redirect, matching every other muster correction surface in this app.
//
// Gated on MUSTER_CORRECT_ROLES, NOT MUSTER_CLOSE_ROLES: it is the correction
// RPCs' own allowlist and the one muster role set with no `site_admin` — she
// holds the cockpit for TODAY, but no surface reaching a PAST day has ever
// given her a door, and this one must not be the first.
//
// Reachable today only by a hand-typed URL. U6b (the grid's anomaly cells, the
// day panel's work-list rows, the spec-374 calendar) is the next unit's job and
// is deliberately NOT built here.

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { ErrorNotice } from "@/components/features/common/notices";
import { WorkerDayFixPanel } from "@/components/features/muster/worker-day-fix-panel";
import { requireRole } from "@/lib/auth/require-role";
import { MUSTER_CLOSE_ROLES, MUSTER_CORRECT_ROLES } from "@/lib/auth/role-home";
import { bangkokTodayIso } from "@/lib/dates";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { createClient as createServerClient } from "@/lib/db/server";
import { ATTENDANCE_FIX_LABEL } from "@/lib/i18n/labels";
import { parseFixParams } from "@/lib/muster/day-fix";
import {
  ADD_ERROR_COPY,
  REOPEN_ERROR_COPY,
  RETIME_ERROR_COPY,
  UNDO_ERROR_COPY,
} from "@/lib/muster/outcome-copy";
import { loadWorkerDayFix } from "@/lib/muster/worker-day-fix";
import { attendanceBackLabel, safeBackHref } from "@/lib/nav/back-href";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: ATTENDANCE_FIX_LABEL };

interface FixPageProps {
  searchParams: Promise<{
    worker?: string | string[];
    date?: string | string[];
    project?: string | string[];
    from?: string | string[];
    retimed?: string | string[];
    retimeError?: string | string[];
    undone?: string | string[];
    undoError?: string | string[];
    added?: string | string[];
    addError?: string | string[];
    reopened?: string | string[];
    reopenError?: string | string[];
  }>;
}

export default async function AttendanceFixPage({ searchParams }: FixPageProps) {
  const ctx = await requireRole(MUSTER_CORRECT_ROLES);
  const sp = await searchParams;
  const backHref = safeBackHref(sp.from, "/team/attendance");
  const backLabel = attendanceBackLabel(backHref);

  function shell(body: React.ReactNode) {
    return (
      <PageShell>
        <BottomTabBar role={ctx.role} />
        <DetailHeader backHref={backHref} backLabel={backLabel}>
          <h1 className="text-title text-ink font-bold tracking-tight">{ATTENDANCE_FIX_LABEL}</h1>
        </DetailHeader>
        <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>{body}</section>
      </PageShell>
    );
  }

  const params = parseFixParams(sp);
  if (params === null) {
    return shell(<ErrorNotice>ลิงก์ไม่ถูกต้อง — ต้องระบุช่างและวันที่ที่ถูกต้อง</ErrorNotice>);
  }
  const { workerId, date, projectId: projectParam } = params;

  const supabase = await createServerClient();
  const admin = createAdminClient();

  const todayIso = bangkokTodayIso();

  // Spec 400 U7 (§D19) — the screen's reads and its render both live in one
  // place now, because the grid's `?fix=` panel renders the same thing. Every
  // narrow-ADMIN justification moved WITH the read; see `worker-day-fix.ts`.
  const data = await loadWorkerDayFix({
    supabase,
    admin,
    workerId,
    date,
    projectParam: projectParam ?? null,
    todayIso,
  });
  if (data === null) {
    return shell(<ErrorNotice>ไม่พบช่างคนนี้</ErrorNotice>);
  }
  const { projectId } = data;

  const retimeOutcome =
    sp.retimed === "1"
      ? ({ ok: true } as const)
      : typeof sp.retimeError === "string" && sp.retimeError.length > 0
        ? ({
            ok: false,
            message: RETIME_ERROR_COPY[sp.retimeError] ?? RETIME_ERROR_COPY.failed!,
          } as const)
        : null;
  const undoOutcome =
    sp.undone === "1"
      ? ({ ok: true } as const)
      : typeof sp.undoError === "string" && sp.undoError.length > 0
        ? ({
            ok: false,
            message: UNDO_ERROR_COPY[sp.undoError] ?? UNDO_ERROR_COPY.failed!,
          } as const)
        : null;
  const addOutcome =
    sp.added === "1"
      ? ({ ok: true } as const)
      : typeof sp.addError === "string" && sp.addError.length > 0
        ? ({ ok: false, message: ADD_ERROR_COPY[sp.addError] ?? ADD_ERROR_COPY.failed! } as const)
        : null;
  const reopenOutcome =
    sp.reopened === "1"
      ? ({ ok: true } as const)
      : typeof sp.reopenError === "string" && sp.reopenError.length > 0
        ? ({
            ok: false,
            message: REOPEN_ERROR_COPY[sp.reopenError] ?? REOPEN_ERROR_COPY.failed!,
          } as const)
        : null;

  const canClose = MUSTER_CLOSE_ROLES.includes(ctx.role);

  // The fix page's own current URL — every write action redirects back here
  // with its outcome appended.
  const returnTo = (() => {
    const q = new URLSearchParams({ worker: workerId, date });
    // The RESOLVED id, not the raw `?project=` param. Reached WITHOUT the param
    // (the project inferred from the first session row), carrying the param
    // forward would drop the project the moment the last session is deleted —
    // the page would come back with no project, hence no closure, no add form
    // and no trail: a dead end immediately after its only destructive action,
    // with no way to re-add the person just removed.
    if (projectId) q.set("project", projectId);
    if (backHref !== "/team/attendance") q.set("from", backHref);
    return `/team/attendance/fix?${q.toString()}`;
  })();

  return shell(
    <WorkerDayFixPanel
      data={data}
      workerId={workerId}
      date={date}
      todayIso={todayIso}
      returnTo={returnTo}
      canClose={canClose}
      outcomes={{
        retime: retimeOutcome,
        undo: undoOutcome,
        add: addOutcome,
        reopen: reopenOutcome,
      }}
    />,
  );
}
