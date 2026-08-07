// Spec 400 U3c-b — "he was here, add him", the correction spec 400 §3 named as
// the commonest one and the only one the app never had.
//
// Presentational only: no fetching, no client hooks, no 'use client'. The page is
// zero-client-JS and this is a plain POST form + a redirect, so it works on the
// in-app browser where hydration does not run — the same shape as the reopen and
// close controls beside it.
//
// Which arm the panel offers is NOT decided here: `addPersonControl` is a pure
// exported function, because U1 proved on this very page that a source scan
// cannot see reachability.
//
// ⚠️ THE TIME FIELD HAS NO DEFAULT, deliberately. A pre-filled 08:00 is a guess
// the app would present as a record, and the entire reason U4 exists is that a
// fabricated timestamp is worse than a missing one: before it, `muster_scan_in`
// stamped the CORRECTION moment and `close_muster_day`'s auto-out turned that
// into a zero-length session — the audit surface manufacturing the anomaly it
// exists to find.

import { addMusterPersonFromForm } from "@/app/team/attendance/actions";
import { formatThaiDate } from "@/lib/i18n/labels";
import { BUTTON_SECONDARY, FIELD_INPUT, FIELD_SELECT } from "@/lib/ui/classes";

export type AddPersonTeam = {
  teamId: string;
  /** Null for an office team — `muster_teams_crew_has_lead` binds `crew` only. */
  leadName: string | null;
  headcount: number;
};

export type AddPersonWorker = { workerId: string; name: string };

export function AttendanceAddPersonForm({
  workDate,
  returnTo,
  teams,
  workers,
}: {
  workDate: string;
  /** The caller's current URL; the redirect appends the outcome to it. */
  returnTo: string;
  /** Rows from `list_muster_teams_for_day` — never empty (the `noTeams` arm). */
  teams: readonly AddPersonTeam[];
  /** The roster minus whoever already has a session that day. */
  workers: readonly AddPersonWorker[];
}) {
  return (
    <form
      action={addMusterPersonFromForm}
      aria-label={`เพิ่มคนที่ตกหล่น ${formatThaiDate(workDate)}`}
      className="mt-3 flex flex-col gap-2"
    >
      <input type="hidden" name="workDate" value={workDate} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
        ทีม
        <select name="teamId" required className={`${FIELD_SELECT} mt-1 max-w-full`}>
          {teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {/* Never an empty option: an office team has no lead, and zero
                  exist in production — so a label assuming one would break on the
                  first one created, silently, with every list still rendering. */}
              {`${t.leadName ?? "ทีมสำนักงาน"} · ${t.headcount} คน`}
            </option>
          ))}
        </select>
      </label>

      <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
        ช่าง
        <select name="workerId" required className={`${FIELD_SELECT} mt-1 max-w-full`}>
          {workers.map((w) => (
            <option key={w.workerId} value={w.workerId}>
              {w.name}
            </option>
          ))}
        </select>
      </label>

      <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
        เวลาเข้างาน
        <input
          type="time"
          name="inTime"
          required
          className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
        />
      </label>

      {/* ABOVE the button: a disclosure a reader meets after the control is a
          disclosure they meet after the tap. Two facts, both true for every
          reader of this form — it is recorded as a correction under their own
          name, and it does not settle the day. */}
      <p className="text-ink-secondary text-[11px]">
        บันทึกเป็นการแก้ไข ระบบจะเก็บชื่อผู้แก้ไขไว้ · เพิ่มแล้วต้องปิดวันอีกครั้งเพื่อคิดค่าแรง
      </p>

      <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
        เพิ่มคนที่ตกหล่น
      </button>
    </form>
  );
}
