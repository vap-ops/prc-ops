// Spec 400 U6a — delete ONE session, via `muster_undo_scan`. Presentational
// only, same zero-client-JS shape as every other muster correction control.
//
// No confirmation checkbox, unlike ปิดวัน: that control books wages for the
// WHOLE day, and this touches one row — the RPC itself already refuses once
// wages are booked or the day is closed, so a second deliberate act here would
// be ceremony around a write the server already guards.
//
// Keyed by (worker, work_date, session) — `muster_undo_scan`'s own unique key
// — so unlike the retime form, no team id travels with it.

import { undoAttendanceSessionFromForm } from "@/app/team/attendance/fix/actions";
import { BUTTON_SECONDARY } from "@/lib/ui/classes";

export function AttendanceFixUndoForm({
  workerId,
  workDate,
  session,
  returnTo,
}: {
  workerId: string;
  workDate: string;
  session: "regular" | "ot";
  /** The caller's current URL; the redirect appends the outcome to it. */
  returnTo: string;
}) {
  return (
    <form
      action={undoAttendanceSessionFromForm}
      aria-label={`ลบการเช็คชื่อ ${session === "ot" ? "OT" : "กะปกติ"}`}
    >
      <input type="hidden" name="workerId" value={workerId} />
      <input type="hidden" name="workDate" value={workDate} />
      <input type="hidden" name="session" value={session} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
        ลบการเช็คชื่อ{session === "ot" ? " OT" : ""}
      </button>
    </form>
  );
}
