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
import { OUT_LOCKED_COPY } from "@/lib/muster/outcome-copy";
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
      {/* The row's CURRENT check-in, Bangkok wall clock. Read ONLY to decide
          whether an out-time belongs to the NEXT calendar day (a night OT
          crossing midnight, which the RPC permits up to 06:00) — never sent to
          the RPC. Derived through the same formatThaiTime the visible line
          uses, so the two can never disagree about the same instant. */}
      <input type="hidden" name="currentInTime" value={formatThaiTime(currentInAt)} />

      <p className="text-ink text-xs font-semibold">{session === "ot" ? "OT" : "กะปกติ"}</p>

      {/* ⚠️ The row wraps (`flex-wrap`) BEFORE anything in it claims a whole
          line. A `basis-*` percentage in a nowrap row is read as "give me 100%"
          and the `min-w-0` sibling collapses to 0px — the defect that took this
          screen out at tablet width. Nothing here claims a line today; the wrap
          is what keeps that true when something does. */}
      {/* Below `@md` it STACKS. A wrapping row in a narrow box put the two time
          fields on different lines at different x-origins with the save button
          beside one of them — measured, and worse than what it replaced. The
          one-row reading is a wide-box affordance; a narrow box gets full-bleed
          fields, which is what a gloved thumb wants anyway.

          ⚠️ Spec 404 U2b — a CONTAINER query, not the `sm:` viewport one it
          replaced. Three surfaces share this form and one of them is a fixed
          280–340px column, where `sm:` fired at every viewport ≥640px and
          produced exactly the ragged เวลาเข้าใหม่ / เวลาออกใหม่ layout it exists
          to prevent. `@md` is 448px — the width at which the current-time block
          and the two 128px fields actually fit on one line. */}
      <div className="flex flex-col gap-2 @md:flex-row @md:flex-wrap @md:items-end">
        <div className="min-w-0">
          <p className="text-ink-secondary text-[11px]">ปัจจุบัน</p>
          {/* ONE range, not two facts in a sentence — the corrector is about to
              replace this pair, so it has to be readable as a pair. An open
              session says so in words rather than printing a dash, which reads
              as "unknown" when it in fact means "nobody checked them out". */}
          <p className="text-ink text-sm tabular-nums">
            {currentOutAt !== null
              ? `${formatThaiTime(currentInAt)} – ${formatThaiTime(currentOutAt)}`
              : `${formatThaiTime(currentInAt)} – ยังไม่เช็คออก`}
          </p>
        </div>

        <label className="text-ink-secondary flex w-full min-w-0 flex-col text-[11px] @md:w-auto">
          เวลาเข้าใหม่
          <input
            type="time"
            name="inTime"
            // A time value is five characters. `w-full` is right in a narrow box
            // and absurd once the row forms, where it spanned the whole card.
            className={`${FIELD_INPUT} mt-1 appearance-none @md:w-32`}
          />
        </label>

        <label className="text-ink-secondary flex w-full min-w-0 flex-col text-[11px] @md:w-auto">
          เวลาออกใหม่
          <input
            type="time"
            name="outTime"
            disabled={outLocked}
            className={`${FIELD_INPUT} mt-1 appearance-none disabled:opacity-50 @md:w-32`}
          />
        </label>

        <button
          type="submit"
          className={`${BUTTON_SECONDARY} self-start @md:ml-auto @md:self-auto`}
        >
          บันทึกเวลาใหม่
        </button>
      </div>

      {/* The rule states itself ONCE, about the form, so neither label has to
          carry a parenthetical about the other field — and it leads with the
          INSTRUCTION (what to do) rather than the mechanic (what a blank field
          means), because the reader is here to change a time, not to learn the
          form's semantics. */}
      <p className="text-ink-secondary text-[11px]">
        กรอกเฉพาะช่องที่ต้องการแก้ ช่องที่เว้นไว้จะไม่เปลี่ยน
      </p>
      {/* The SAME string the action's `locked` outcome uses — one home, so the
          disclosure before the tap and the refusal after it cannot drift. */}
      {outLocked && <p className="text-ink-secondary text-[11px]">{OUT_LOCKED_COPY}</p>}
    </form>
  );
}
