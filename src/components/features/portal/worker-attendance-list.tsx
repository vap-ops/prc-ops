// Spec 388 U2 — the ช่าง's own attendance record, one entry per SESSION.
//
// This surface makes claims about a person, so three of its rules are about what
// it must NOT say:
//   * a manually-entered row gets NO verdict — its timestamp is the SA's tap,
//     not the worker's arrival (spec 388 D7);
//   * an auto-closed check-out says so, because it is not a departure the worker
//     made;
//   * an open day shows no out time rather than implying one.
//
// Pure render from the view model — no I/O, no date math (all of that lives in
// lib/attendance/attendance-sessions.ts, where it is unit-tested at the 08:15
// boundary). Server Component: nothing here is interactive.

import { EmptyNotice } from "@/components/features/common/notices";
import { CARD } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";
import {
  ATTENDANCE_AUTO_CLOSED_NOTE,
  ATTENDANCE_LATE_LABEL,
  ATTENDANCE_MANUAL_NOTE,
  ATTENDANCE_ON_TIME_LABEL,
  ATTENDANCE_OPEN_SESSION_LABEL,
  ATTENDANCE_OT_SESSION_LABEL,
  ATTENDANCE_OWN_EMPTY_LABEL,
  ATTENDANCE_SUMMARY_DAYS_LABEL,
} from "@/lib/i18n/labels";
import type {
  AttendanceSessionRow,
  AttendanceSessions,
} from "@/lib/attendance/attendance-sessions";

function SummaryCell({ testId, label, value }: { testId: string; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span data-testid={testId} className="text-ink text-lg font-bold tabular-nums">
        {value}
      </span>
      <span className="text-ink-secondary text-xs">{label}</span>
    </div>
  );
}

// The repo's established chip idiom (expense-list.tsx): a rounded-control
// border pill coloured from the globals.css token pairs. `done` is this design
// system's success family — there is no `success` token, and the design-doctrine
// guard rejects invented ones.
const CHIP = "rounded-control border px-2 py-0.5 text-xs font-medium";

function VerdictChip({ verdict }: { verdict: AttendanceSessionRow["verdict"] }) {
  if (verdict === "none") return null;
  const late = verdict === "late";
  return (
    <span
      className={`${CHIP} ${
        late
          ? "border-danger-edge bg-danger-soft text-danger-ink"
          : "border-done-edge bg-done-soft text-done-ink"
      }`}
    >
      {late ? ATTENDANCE_LATE_LABEL : ATTENDANCE_ON_TIME_LABEL}
    </span>
  );
}

export function WorkerAttendanceList({ built }: { built: AttendanceSessions }) {
  const { rows, summary } = built;

  return (
    <>
      <div data-testid="attendance-summary" className={`${CARD} mb-4`}>
        <div className="flex items-center justify-around">
          <SummaryCell
            testId="summary-days"
            label={ATTENDANCE_SUMMARY_DAYS_LABEL}
            value={summary.daysRecorded}
          />
          <SummaryCell
            testId="summary-on-time"
            label={ATTENDANCE_ON_TIME_LABEL}
            value={summary.onTime}
          />
          <SummaryCell testId="summary-late" label={ATTENDANCE_LATE_LABEL} value={summary.late} />
          <SummaryCell
            testId="summary-ot"
            label={ATTENDANCE_OT_SESSION_LABEL}
            value={summary.otSessions}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyNotice>{ATTENDANCE_OWN_EMPTY_LABEL}</EmptyNotice>
      ) : (
        <ul data-testid="attendance-rows" className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={`${r.workDate}-${r.session}`} className={CARD}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-ink text-sm font-semibold">{formatThaiDate(r.workDate)}</p>
                <div className="flex items-center gap-2">
                  {r.session !== "regular" ? (
                    <span className={`${CHIP} border-edge text-ink-secondary`}>
                      {ATTENDANCE_OT_SESSION_LABEL}
                    </span>
                  ) : null}
                  <VerdictChip verdict={r.verdict} />
                </div>
              </div>

              <div className="text-ink-secondary mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="text-ink tabular-nums">{r.inTime ?? "—"}</span>
                <span aria-hidden>→</span>
                {r.outTime ? (
                  <span className="text-ink tabular-nums">
                    {r.outTime}
                    {r.outNextDay ? " (+1)" : ""}
                  </span>
                ) : (
                  <span>{ATTENDANCE_OPEN_SESSION_LABEL}</span>
                )}
                {r.otHours > 0 ? <span>{`${r.otHours} ชม.`}</span> : null}
              </div>

              {/* The two honesty notes. Neither is decoration: each says the
                  record is weaker than it looks. */}
              {r.inMethod !== null && r.inMethod !== "qr" ? (
                <p className="text-ink-secondary mt-1 text-xs">{ATTENDANCE_MANUAL_NOTE}</p>
              ) : null}
              {r.outAuto ? (
                <p className="text-ink-secondary mt-1 text-xs">{ATTENDANCE_AUTO_CLOSED_NOTE}</p>
              ) : null}

              {r.projectName ? (
                <p className="text-ink-secondary mt-1 text-xs">{r.projectName}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
