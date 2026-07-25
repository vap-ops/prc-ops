"use client";

// Spec 306 close-day carryover — the muster cockpit's prior-day nag.
//
// Twice running (2026-07-24, 2026-07-25) the pilot SA checked every worker out
// and never pressed ปิดวัน, so the day was never closed and the wage derive never
// ran. The sticky ปิดวัน bar (the same spec's earlier fix) only helps while the
// SA is still looking at that day's board; once midnight rolls the cockpit is
// locked to the new date and the missed day has no surface at all. This banner
// is that surface.
//
// Deliberate design calls (operator-approved 2026-07-25):
// - WARN, never FORCE. The morning muster is time-critical — the SA is scanning a
//   line of workers — so this must never gate today's board on yesterday's admin.
//   That is also why only the newest few days RENDER: an unbounded list would
//   push the board below the fold and become a soft gate. Closing one reveals the
//   next, so nothing is unreachable (the READER is unbounded — see
//   prior-day-close.ts on why a lookback cap is unsafe).
// - NOT dismissible. There is no hide/ignore control: the list is derived from
//   the closure rows, so the only way to clear it is to actually close the day.
//   A dismiss button would recreate the exact "I'll do it later" failure it
//   exists to catch, and a nag that can be silenced trains people to silence it.
// - Confirm-then-close, with two disclosures. A bare one-tap close would repeat
//   the 07-24 data loss through a new door.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeMusterDay } from "@/lib/muster/actions";
import { formatThaiDate } from "@/lib/i18n/labels";
import type { UnclosedPriorDay } from "@/lib/muster/prior-day-close";

// How many days get their own row + close button. The rest are summarised; each
// close promotes the next one into view.
export const PRIOR_DAY_ROWS = 5;

// Single-use copy, kept local rather than in labels.ts (the MusterTodayCard /
// close-day-bar precedent): none of these strings is rendered anywhere else, and
// adding them to the shared SSOT would serialise this lane against every other.
//
// NOTE: byte-identical to BAR_BTN/BAR_PRIMARY/BAR_SUNK in muster-cockpit.tsx.
// Kept separate deliberately — these are two independent surfaces that may
// legitimately diverge — but if you restyle one, look at the other.
const BTN = "min-h-11 rounded-lg px-4 text-sm font-bold disabled:opacity-50";

// Deliberately NOT `${CARD} border-attn bg-attn-soft`: CARD bundles `bg-card` +
// `border-edge`, and two utilities for the same property on one element are
// resolved by the GENERATED stylesheet's order, not by the order they appear in
// the className — CARD won, and the amber warning rendered as a plain white card
// with a grey border (found by probing the live page; every test was green).
// Spell out CARD's layout half and let the attention tokens own colour outright.
const BANNER = "rounded-card shadow-card border border-attn bg-attn-soft text-attn-ink px-4 py-3";

export function PriorDayCloseBanner({
  projectId,
  revalidate,
  days,
}: {
  projectId: string;
  revalidate: string;
  days: ReadonlyArray<UnclosedPriorDay>;
}) {
  const router = useRouter();
  // Which day's close is armed. One at a time: arming a second day must not leave
  // the first one one stray tap away from closing.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Attributed to the day it came from — with several days listed, an unattributed
  // message leaves the SA unable to tell which one to retry.
  const [failure, setFailure] = useState<{ date: string; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (days.length === 0) return null;

  const shown = days.slice(0, PRIOR_DAY_ROWS);
  const older = days.length - shown.length;

  const close = (date: string) => {
    setConfirming(null);
    startTransition(async () => {
      const res = await closeMusterDay({ projectId, date, revalidate });
      if (!res.ok) {
        setFailure({ date, message: res.error });
        return;
      }
      setFailure(null);
      // The closed day drops out of `days` on the next server render — the
      // banner shrinks by itself and disappears when the last one is closed.
      router.refresh();
    });
  };

  return (
    <div className={BANNER}>
      <p className="text-sm font-bold">ยังไม่ได้ปิดวันทำงานที่ผ่านมา</p>
      <p className="text-meta mt-1">ปิดวันเพื่อบันทึกค่าแรงของวันนั้น</p>

      <ul className="mt-3 flex flex-col gap-2">
        {shown.map((day) => {
          const armed = confirming === day.date;
          const thaiDate = formatThaiDate(day.date);
          return (
            <li
              key={day.date}
              data-testid={`unclosed-day-${day.date}`}
              className="border-attn-edge flex flex-col gap-2 border-t pt-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {thaiDate} · {day.teamCount} ทีม
                </p>
                {armed ? null : (
                  <button
                    type="button"
                    // The page also renders the today-bar's ปิดวัน button, so a
                    // bare name would give a screen reader two identical buttons.
                    aria-label={`ปิดวัน ${thaiDate}`}
                    onClick={() => {
                      setFailure(null);
                      setConfirming(day.date);
                    }}
                    disabled={pending}
                    className={`bg-fill text-on-fill ${BTN}`}
                  >
                    ปิดวัน
                  </button>
                )}
              </div>

              {armed ? (
                <>
                  {/* Arming swaps the button out, so focus lands on <body> and a
                      screen reader hears nothing — the disclosures below are the
                      whole reason this is a two-tap flow. Announce them. */}
                  <div role="status" aria-live="polite" className="flex flex-col gap-1">
                    {day.openOt > 0 ? (
                      // A DISCLOSURE, not a "close their OT first" prompt: on a
                      // past day no surface anywhere can still close those
                      // sessions, so the span is already gone. The today-bar's
                      // sibling warning IS actionable and reads differently on
                      // purpose — same fact, different what-you-can-do-about-it.
                      <p className="text-meta font-semibold">
                        ช่าง {day.openOt} คนไม่ได้ปิด OT ของวันนั้น และไม่มีเวลาออกในระบบ —
                        ปิดวันจะไม่บันทึก OT ให้
                      </p>
                    ) : null}
                    {/* The wage derive snapshots each worker's CURRENT day_rate;
                        there is no effective-dated rate history. Closing an old
                        day therefore books it at today's rate. Nothing the SA can
                        do about it, but they are authorising a money write and
                        should know its basis. */}
                    <p className="text-meta">ค่าแรงจะบันทึกตามอัตราปัจจุบันของช่าง</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      // The button this replaces has just unmounted under the
                      // user's finger; without this, focus falls to <body> and a
                      // keyboard/screen-reader SA has to hunt for the confirm.
                      autoFocus
                      aria-label={`ยืนยันปิดวัน ${thaiDate}`}
                      onClick={() => close(day.date)}
                      disabled={pending}
                      className={`bg-fill text-on-fill flex-1 ${BTN}`}
                    >
                      ยืนยันปิดวัน
                    </button>
                    <button
                      type="button"
                      aria-label={`ยกเลิก ${thaiDate}`}
                      onClick={() => setConfirming(null)}
                      disabled={pending}
                      className={`bg-sunk text-ink ${BTN}`}
                    >
                      ยกเลิก
                    </button>
                  </div>
                </>
              ) : null}

              {failure?.date === day.date ? (
                <p role="alert" className="text-danger text-meta font-semibold">
                  {failure.message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {older > 0 ? (
        <p className="text-meta mt-2">
          และอีก {older} วันเก่ากว่านั้น · ปิดวันด้านบนแล้วรายการถัดไปจะแสดงขึ้นมา
        </p>
      ) : null}
    </div>
  );
}
