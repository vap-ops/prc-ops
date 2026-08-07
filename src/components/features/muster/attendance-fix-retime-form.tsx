// Spec 400 U6a — retime ONE existing session, via `muster_correct_session`'s
// UPDATE path. Presentational only: no fetching, no client hooks, no
// 'use client' — a plain POST form + redirect, the same shape as every other
// muster correction control in this app.
//
// ⚠️ NO TIME DEFAULTS, deliberately — the same rule the add form follows. A
// pre-filled guess is a fabricated record the app would be presenting as fact;
// the current recorded times are shown as READ-ONLY text above the inputs
// instead, so the corrector can compare without either field being seeded from
// them.
//
// Offered even on a CLOSED day: this form's real guard is
// `muster_correct_session`'s own unbooked-wage anti-join, not the day's
// closure state — see the design note in fix/page.tsx.

import { correctMusterSessionFromForm } from "@/app/team/attendance/fix/actions";
import { formatThaiTime } from "@/lib/i18n/labels";
import { BUTTON_SECONDARY, FIELD_INPUT } from "@/lib/ui/classes";

export function AttendanceFixRetimeForm({
  teamId,
  workerId,
  session,
  workDate,
  returnTo,
  currentInAt,
  currentOutAt,
  outLocked,
}: {
  teamId: string;
  workerId: string;
  session: "regular" | "ot";
  workDate: string;
  /** The caller's current URL; the redirect appends the outcome to it. */
  returnTo: string;
  /** The row's CURRENT times, shown as facts beside the (blank) inputs. */
  currentInAt: string;
  currentOutAt: string | null;
  /** `outTimeLocked` — a human-recorded check-out cannot be replaced. */
  outLocked: boolean;
}) {
  return (
    <form
      action={correctMusterSessionFromForm}
      aria-label={session === "ot" ? "แก้เวลา OT" : "แก้เวลากะปกติ"}
      className="mt-3 flex flex-col gap-2"
    >
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="workerId" value={workerId} />
      <input type="hidden" name="session" value={session} />
      <input type="hidden" name="workDate" value={workDate} />
      <input type="hidden" name="returnTo" value={returnTo} />

      <p className="text-ink text-xs font-semibold">{session === "ot" ? "OT" : "กะปกติ"}</p>
      <p className="text-ink-secondary text-xs">
        ปัจจุบัน เข้า {formatThaiTime(currentInAt)}
        {currentOutAt !== null ? ` · ออก ${formatThaiTime(currentOutAt)}` : " · ยังไม่เช็คออก"}
      </p>

      <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
        เวลาเข้างานใหม่ (เว้นว่าง = ไม่แก้)
        <input
          type="time"
          name="inTime"
          className={`${FIELD_INPUT} mt-1 max-w-full appearance-none`}
        />
      </label>

      <label className="text-ink-secondary flex min-w-0 flex-col text-xs">
        เวลาออกงานใหม่ (เว้นว่าง = ไม่แก้)
        <input
          type="time"
          name="outTime"
          disabled={outLocked}
          className={`${FIELD_INPUT} mt-1 max-w-full appearance-none disabled:opacity-50`}
        />
      </label>
      {outLocked && (
        <p className="text-ink-secondary text-[11px]">
          เวลาออกนี้บันทึกโดยคนแล้ว แก้ไขไม่ได้ — ต้องลบแล้วเพิ่มใหม่
        </p>
      )}

      <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
        บันทึกเวลาใหม่
      </button>
    </form>
  );
}
