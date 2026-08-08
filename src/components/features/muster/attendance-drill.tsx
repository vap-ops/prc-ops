// Spec 358 U3 — the per-day drill panel, extracted from the /team/attendance page
// so it can be rendered in a test. The page is a Server Component, so with the
// markup inline NOTHING pinned the Thai strings, the day-aware wording, or the
// link idiom — which is exactly why the first cut shipped a drill that
// contradicted the summary chip and was invisible on touch. Presentational only:
// no data fetching, no client hooks, no 'use client'.

import { MusterReopenForm } from "@/components/features/muster/muster-reopen-form";
import { formatThaiDate } from "@/lib/i18n/labels";
import {
  dayClosureLabel,
  openSessionLabel,
  type AttendanceDetailDay,
} from "@/lib/muster/attendance-audit";

function formatNumber(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 1 });
}

export function AttendanceDrill({
  days,
  todayIso,
  canReopen = false,
  canClose = false,
  backHref = "/team/attendance",
}: {
  days: AttendanceDetailDay[];
  todayIso: string;
  /**
   * Spec 397 U3 — whether to offer the reopen form. Resolved by the page from
   * MUSTER_REOPEN_ROLES, which mirrors the RPC's own allowlist; withholding it
   * withholds the CONTROL only, never the closure FACT above it.
   */
  canReopen?: boolean;
  /**
   * Whether the VIEWER can also close the day again — MUSTER_CLOSE_ROLES, which
   * is exactly `close_muster_day`'s LIVE allowlist. ⚠️ It was SA_SURFACE_ROLES
   * until spec 400 U3a widened that RPC to `procurement`; keeping the old set
   * would have gone on telling the one role this work exists for to hand the
   * close step to the SA.
   */
  canClose?: boolean;
  /** Where the form returns to — the caller's current URL, outcome appended. */
  backHref?: string;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {days.map((day) => (
        <li key={day.workDate}>
          {/* The two per-DAY facts: closure state and the project. A worker-day is
              provably single-project (muster_scan_in ties an OT session to the
              same team; move_muster_worker refuses cross-project), so printing
              the project per session just repeated it. Closure only reads as a
              FINDING once the day is over — today is legitimately still open. */}
          <p className="text-ink-secondary text-xs font-semibold">
            {formatThaiDate(day.workDate)}
            {` · ${dayClosureLabel(day, todayIso)}`}
            {day.projectName ? ` · ${day.projectName}` : ""}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {day.sessions.map((s) => (
              <li key={`${s.workDate}-${s.session}`} className="text-ink text-xs">
                <span className="font-medium">{s.session === "ot" ? "OT" : "งานปกติ"}</span>{" "}
                {s.inTime}
                {" – "}
                {/* Day-aware wording so the drill AGREES with the summary chip
                    instead of contradicting it, and (+1 วัน) so an OT session
                    closed after midnight cannot read as out-before-in. */}
                {s.stillIn ? openSessionLabel(s, todayIso) : s.outTime}
                {s.outNextDay ? " (+1 วัน)" : ""}
                {s.outAuto ? " (อัตโนมัติ)" : ""}
                {s.otHours !== null ? ` · ${formatNumber(s.otHours)} ชม.` : ""}
                <span className="text-ink-secondary">
                  {" · เข้า: "}
                  {s.inMethod === "qr" ? "สแกน QR" : "บันทึกมือ"}
                  {/* The check-out's provenance is the fact that actually varies;
                      out_auto is false on every live row (no auto-out cron). */}
                  {s.outMethod ? ` · ออก: ${s.outMethod === "qr" ? "สแกน QR" : "บันทึกมือ"}` : ""}
                  {s.scannedByName ? ` · โดย ${s.scannedByName}` : ""}
                  {s.teamLeadName ? ` · ทีม ${s.teamLeadName}` : ""}
                </span>
              </li>
            ))}
          </ul>

          {/* Spec 397 U3 — the way back from a closed day. On the DAY, because
              closure is a project-day fact; only when the day IS closed (there is
              nothing to reopen otherwise) and only for a role the RPC admits.
              Plain POST form + redirect: this page carries no client JS, and the
              control must work on the in-app browser where hydration does not run.
              The helper line states the loop — reopening alone leaves the day
              underived, which the summary already flags as ยังไม่ได้ปิด. */}
          {canReopen && day.dayClosed && (
            <MusterReopenForm
              projectId={day.projectId}
              workDate={day.workDate}
              returnTo={backHref}
              canClose={canClose}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
