// Spec 400 U6a — add the fix page's OWN missing person. A single-worker variant
// of AttendanceAddPersonForm: the day panel's form offers a WORKER dropdown
// because it serves any of the day's un-mustered roster, but this page already
// knows exactly who — the worker is fixed by the URL, not chosen here.
//
// Reuses `addMusterPersonFromForm` unchanged: `MUSTER_CORRECT_ROLES` is exactly
// `muster_correct_session`'s own allowlist, so there is no scope difference
// between this page and the day panel that would justify a second action.

import { addMusterPersonFromForm } from "@/app/team/attendance/actions";
import type { AddPersonTeam } from "@/components/features/muster/attendance-add-person-form";
import { BUTTON_SECONDARY, FIELD_INPUT, FIELD_SELECT } from "@/lib/ui/classes";

export function AttendanceFixAddForm({
  workerId,
  workDate,
  returnTo,
  teams,
}: {
  workerId: string;
  workDate: string;
  /** The caller's current URL; the redirect appends the outcome to it. */
  returnTo: string;
  /** Rows from `list_muster_teams_for_day` — never empty (the `noTeams` arm
   *  withholds this form entirely when it would be). */
  teams: readonly AddPersonTeam[];
}) {
  return (
    <form
      action={addMusterPersonFromForm}
      aria-label="เพิ่มคนที่ตกหล่น"
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="workerId" value={workerId} />
      <input type="hidden" name="workDate" value={workDate} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
        ทีม
        <select name="teamId" required className={`${FIELD_SELECT} mt-1 max-w-full`}>
          {teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {/* Never an empty option: an office team has no lead. */}
              {`${t.leadName ?? "ทีมสำนักงาน"} · ${t.headcount} คน`}
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

      <p className="text-ink-secondary text-[11px]">
        บันทึกเป็นการแก้ไข ระบบจะเก็บชื่อผู้แก้ไขไว้ · เพิ่มแล้วต้องปิดวันอีกครั้งเพื่อคิดค่าแรง
      </p>

      <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
        เพิ่มคนที่ตกหล่น
      </button>
    </form>
  );
}
