// ปิดวัน — ONE close form, for every surface that offers the act.
//
// It exists because the copy was wrong the moment there were two copies of it.
// The per-worker panel's hand-written bullets said
// `ช่างที่ยังไม่เช็คออกจะถูกบันทึกเวลาออก 17:00 ให้` — true of REGULAR sessions and
// FALSE of OT: `close_muster_day` auto-outs `and a.session = 'regular'` only and
// leaves an open OT row untouched, and no RPC can back-date a check-out, so that
// OT is permanently unbookable. The day panel had always disclosed the loss
// (`ปิดวันจะไม่บันทึก OT ให้`); the second copy silently dropped it.
//
// So the disclosure lives here once, beside `MusterReopenForm`, and the two
// halves of the loop are now symmetrical components rather than one component
// and N inlined forms.
//
// Presentational only, plain POST + redirect: every muster correction surface is
// zero-client-JS because the in-app browser's hydration cannot be relied on.

import { closeMusterDayFromForm } from "@/app/team/attendance/actions";
import { MUSTER_DAY_CLOSE_MEANING, formatThaiDate } from "@/lib/i18n/labels";
import { BUTTON_SECONDARY } from "@/lib/ui/classes";

/** Who is still checked in when the day is closed, by session kind. */
export interface MusterStillIn {
  /** Auto-outed at 17:00 — named, because the fabricated time is theirs. */
  regular: readonly string[];
  /** NOT closed by `close_muster_day`; their OT is lost. */
  ot: readonly string[];
}

export function MusterCloseDayForm({
  projectId,
  workDate,
  returnTo,
  stillIn = null,
  className = "mt-3",
}: {
  projectId: string;
  workDate: string;
  /** Where the write redirects — the CALLER's own URL, outcome appended. */
  returnTo: string;
  /**
   * The day's own still-in roster, when the surface can know it.
   *
   * `null` on a PER-WORKER surface: it loads one worker, so it cannot count the
   * day's others, and inventing a number is worse than stating the rule. The
   * rule is then given in general form — which is why the OT sentence has to be
   * unconditional rather than driven off an empty list.
   */
  stillIn?: MusterStillIn | null;
  className?: string;
}) {
  return (
    <form
      action={closeMusterDayFromForm}
      aria-label={`ปิดวัน ${formatThaiDate(workDate)}`}
      className={`${className} flex flex-col gap-2`}
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="workDate" value={workDate} />
      <input type="hidden" name="returnTo" value={returnTo} />

      {/* ABOVE the control, because a disclosure a reader meets after the button
          is a disclosure they meet after the tap. */}
      <ul className="text-ink-secondary flex flex-col gap-1 text-[11px]">
        {/* What the word itself means, first — the rest of this list is the
            consequences OF it, which read as a non-sequitur to anyone who does
            not already know what ปิดวัน does (operator, 2026-08-07). */}
        <li>{MUSTER_DAY_CLOSE_MEANING}</li>
        {stillIn === null ? (
          <>
            <li>มีผลทั้งวัน คิดค่าแรงใหม่ทุกคน ไม่ใช่แค่ช่างคนนี้</li>
            {/* REGULAR, said out loud. The unqualified version of this sentence
                is the bug this component exists to make unrepeatable. */}
            <li>ช่างที่ยังไม่เช็คออกจะถูกบันทึกเวลาออก 17:00 ให้ เฉพาะงานปกติ</li>
            <li>ปิดวันจะไม่บันทึก OT ให้ — OT ที่ยังไม่เช็คออกจะไม่ถูกคิดค่าแรง</li>
          </>
        ) : (
          <>
            {stillIn.regular.length > 0 && (
              <li>
                {`ช่าง ${stillIn.regular.length} คนยังไม่เช็คออก — ระบบจะบันทึกเวลาออก 17:00 ให้ · ${stillIn.regular.join(", ")}`}
              </li>
            )}
            {stillIn.ot.length > 0 && (
              <li>
                {`ปิดวันจะไม่บันทึก OT ให้ — OT ที่ยังไม่เช็คออก ${stillIn.ot.length} คน · ${stillIn.ot.join(", ")}`}
              </li>
            )}
            <li>ค่าแรงจะบันทึกตามอัตราปัจจุบันของช่าง</li>
          </>
        )}
        <li>ปิดแล้วแก้ไขการเช็คชื่อไม่ได้จนกว่าจะเปิดวันอีกครั้ง</li>
      </ul>

      {/* The second deliberate act, in the only form a zero-client-JS surface can
          carry one: a `required` checkbox the browser enforces with no hydration.
          It travels WITH the control, so no surface can become the softer door to
          the same write. */}
      <label className="text-ink flex min-h-11 items-center gap-2 text-xs">
        <input type="checkbox" name="confirm" required value="1" className="size-4 shrink-0" />
        เข้าใจแล้วว่าปิดวันดังกล่าวจะบันทึกเวลาออกและคิดค่าแรง
      </label>

      <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
        ปิดวัน
      </button>
    </form>
  );
}
