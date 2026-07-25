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
// - NOT dismissible. There is no hide/ignore control: the list is derived from
//   the closure rows, so the only way to clear it is to actually close the day.
//   A dismiss button would recreate the exact "I'll do it later" failure it
//   exists to catch, and a nag that can be silenced trains people to silence it.
// - Confirm-then-close, with the OT disclosure. A bare one-tap close would repeat
//   the 07-24 data loss through a new door.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeMusterDay } from "@/lib/muster/actions";
import { formatThaiDate } from "@/lib/i18n/labels";
import { CARD } from "@/lib/ui/classes";
import type { UnclosedPriorDay } from "@/lib/muster/prior-day-close";

// Single-use copy, kept local rather than in labels.ts (the MusterTodayCard /
// close-day-bar precedent): none of these strings is rendered anywhere else, and
// adding them to the shared SSOT would serialise this lane against every other.
const BTN = "min-h-11 rounded-lg px-4 text-sm font-bold disabled:opacity-50";

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (days.length === 0) return null;

  const close = (date: string) => {
    setConfirming(null);
    startTransition(async () => {
      const res = await closeMusterDay({ projectId, date, revalidate });
      if (!res.ok) {
        setError(res.error ?? "ปิดวันไม่สำเร็จ");
        return;
      }
      setError(null);
      // The closed day drops out of `days` on the next server render — the
      // banner shrinks by itself and disappears when the last one is closed.
      router.refresh();
    });
  };

  return (
    <div className={`${CARD} border-attn bg-attn-soft text-attn-ink`}>
      <p className="text-sm font-bold">ยังไม่ได้ปิดวันทำงานที่ผ่านมา</p>
      <p className="text-meta mt-1">ปิดวันเพื่อบันทึกค่าแรงของวันนั้น</p>

      <ul className="mt-3 flex flex-col gap-2">
        {days.map((day) => (
          <li
            key={day.date}
            data-testid={`unclosed-day-${day.date}`}
            className="border-attn-edge flex flex-col gap-2 border-t pt-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {formatThaiDate(day.date)} · {day.teamCount} ทีม
              </p>
              {confirming === day.date ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setConfirming(day.date);
                  }}
                  disabled={pending}
                  className={`bg-fill text-on-fill ${BTN}`}
                >
                  ปิดวัน
                </button>
              )}
            </div>

            {confirming === day.date ? (
              <>
                {day.openOt > 0 ? (
                  // Worded as a DISCLOSURE, not a "close their OT first" prompt:
                  // on a past day no surface anywhere can still close those
                  // sessions, so the span is already gone. The today-bar's
                  // sibling warning IS actionable and reads differently on
                  // purpose — same fact, different what-you-can-do-about-it.
                  <p className="text-meta font-semibold">
                    ช่าง {day.openOt} คนไม่ได้ปิด OT ของวันนั้น และไม่มีเวลาออกในระบบ —
                    ปิดวันจะไม่บันทึก OT ให้
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => close(day.date)}
                    disabled={pending}
                    className={`bg-fill text-on-fill flex-1 ${BTN}`}
                  >
                    ยืนยันปิดวัน
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={pending}
                    className={`bg-sunk text-ink ${BTN}`}
                  >
                    ยกเลิก
                  </button>
                </div>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="text-danger text-meta mt-2 font-semibold">
          {error}
        </p>
      ) : null}
    </div>
  );
}
