// Spec 358 U3 — the per-day drill panel, extracted from the /team/attendance page
// so it can be rendered in a test. The page is a Server Component, so with the
// markup inline NOTHING pinned the Thai strings, the day-aware wording, or the
// link idiom — which is exactly why the first cut shipped a drill that
// contradicted the summary chip and was invisible on touch. Presentational only:
// no data fetching, no client hooks, no 'use client'.

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
}: {
  days: AttendanceDetailDay[];
  todayIso: string;
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
        </li>
      ))}
    </ul>
  );
}
