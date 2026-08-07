// Spec 397 U3 / 400 U3b — the reopen control, extracted so the LIST's drill and
// the GRID's day panel cannot drift apart.
//
// It was inline in attendance-drill.tsx until U3b needed the same control on the
// grid. Copying it would have duplicated three things that already cost a review
// finding each: the required-at-the-input reason, the `returnTo` the redirect
// depends on, and the role-aware loop instruction. Presentational only.

import { reopenMusterDayFromForm } from "@/app/team/attendance/actions";
import { MUSTER_DAY_REOPEN_MEANING, formatThaiDate } from "@/lib/i18n/labels";
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
    // ⚠️ `sm:flex-wrap` is load-bearing, not decoration. The helper line at the
    // bottom is `basis-full` — a whole-line claim that only means anything in a
    // row that WRAPS. Without it the row is `nowrap`, the <p> competes for 100%
    // of the width, and the `flex-1 min-w-0` label absorbs the entire deficit:
    // measured live at 1194px the label collapsed to 0px wide, its Thai text
    // stacked one character per line into a 279px-tall column, and the button
    // painted over the reason input.
    <form
      action={reopenMusterDayFromForm}
      aria-label={`เปิดวัน ${formatThaiDate(workDate)} อีกครั้ง`}
      className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="workDate" value={workDate} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {/* What the WORD means, before the control that performs it. Operator,
          2026-08-07: "ปิด เปิด วัน is not clear. provide instructions if you
          want to use these words." It lives here rather than on either page so
          both surfaces offering the action explain it identically, and it sits
          ABOVE the control — a disclosure met after the button is met after the
          tap. `basis-full` is safe: the row wraps. */}
      <p className="text-ink-secondary basis-full text-[11px]">{MUSTER_DAY_REOPEN_MEANING}</p>
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
      {/* ⚠️ This line used to open "แก้ไขแล้ว…" — it assumed the reader would
          correct the check-ins between the reopen and the close. Nothing on any
          page they can open does that: the two undo surfaces are hard-locked to
          `bangkokTodayIso()` and gated on SA_SURFACE_ROLES, and the add-person
          path is deferred to U4 (muster_scan_in stamps in_at = now(), so a
          past-day correction would record the wrong time). What re-closing DOES
          do is re-derive the day from the latest rates and WP bindings — so that
          is what it now says. */}
      {/* Only the half the meaning line above CANNOT carry: WHO closes the day.
          A reader who may close it themselves already read "แก้เสร็จต้องปิดวันใหม่
          ค่าแรงจึงจะคิดใหม่ทั้งวัน" there, and saying it twice in one card is what
          made this group a wall of text. A reader who may NOT close it needs the
          extra fact that the step is someone else's. */}
      {!canClose && (
        <p className="text-ink-secondary basis-full text-[11px]">
          แจ้ง SA ให้ปิดวันใหม่ ค่าแรงจึงจะถูกคิดใหม่
        </p>
      )}
    </form>
  );
}
