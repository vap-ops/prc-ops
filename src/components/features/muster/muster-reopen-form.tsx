// Spec 397 U3 / 400 U3b — the reopen control, extracted so the LIST's drill and
// the GRID's day panel cannot drift apart.
//
// It was inline in attendance-drill.tsx until U3b needed the same control on the
// grid. Copying it would have duplicated three things that already cost a review
// finding each: the required-at-the-input reason, the `returnTo` the redirect
// depends on, and the role-aware loop instruction. Presentational only.

import { reopenMusterDayFromForm } from "@/app/team/attendance/actions";
import { formatThaiDate } from "@/lib/i18n/labels";
import { BUTTON_SECONDARY, FIELD_INPUT } from "@/lib/ui/classes";

export function MusterReopenForm({
  projectId,
  workDate,
  returnTo,
  canClose = false,
}: {
  projectId: string;
  workDate: string;
  /** The caller's current URL — the redirect appends the outcome to it. */
  returnTo: string;
  /**
   * Whether the VIEWER can also close the day again (MUSTER_CLOSE_ROLES —
   * exactly `close_muster_day`'s live allowlist). The loop is reopen → fix →
   * close, and naming a step the reader's own server refuses is the defect this
   * branch exists to avoid.
   */
  canClose?: boolean;
}) {
  return (
    <form
      action={reopenMusterDayFromForm}
      aria-label={`เปิดวัน ${formatThaiDate(workDate)} อีกครั้ง`}
      className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="workDate" value={workDate} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="text-ink-secondary flex min-w-0 flex-1 flex-col text-[11px]">
        เหตุผลที่เปิดอีกครั้ง
        <input
          type="text"
          name="reason"
          required
          maxLength={200}
          placeholder="เช่น ลงเวลาไม่ครบ 19 คน"
          className={`${FIELD_INPUT} mt-1 max-w-full`}
        />
      </label>
      <button type="submit" className={`${BUTTON_SECONDARY} shrink-0`}>
        เปิดวันอีกครั้ง
      </button>
      <p className="text-ink-secondary basis-full text-[11px]">
        {canClose
          ? "แก้ไขแล้วต้องปิดวันใหม่ ค่าแรงจึงจะถูกคิดใหม่"
          : "แจ้ง SA ให้แก้ไขและปิดวันใหม่ ค่าแรงจึงจะถูกคิดใหม่"}
      </p>
    </form>
  );
}
