"use client";

// Spec 277 P0 — the SA-home muster strip. Folds today's แผนวันนี้ crew into one line
// ("ทีมงานวันนี้ · X/Y มาทำ") sitting just above the plan, so the SA sees at a glance
// who has turned up without scanning every งานย่อย. "ทั้งหมดมาทำ" logs every
// still-absent worker at once through the shared useMarkPresent hook (the same
// log_labor_day path the per-worker taps use). Renders nothing on a day with no plan.
// 'use client': the button action + router refresh.

import { Users } from "lucide-react";
import { useMarkPresent } from "@/lib/sa/use-mark-present";
import type { MusterSummary } from "@/lib/sa/muster";
import { BUTTON_PRIMARY_COMPACT, CARD } from "@/lib/ui/classes";

// Cap the presence dots so a big crew doesn't overflow the strip on a phone.
const MAX_DOTS = 8;

export function MusterStrip({ summary, dateIso }: { summary: MusterSummary; dateIso: string }) {
  const { busy, mark, error } = useMarkPresent(dateIso);

  if (summary.total === 0) return null;
  const allPresent = summary.present >= summary.total;
  const dots = Math.min(summary.total, MAX_DOTS);
  const litDots = Math.min(summary.present, dots);

  return (
    <div className={`${CARD} flex items-center gap-3`}>
      <Users aria-hidden className="text-action size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-body text-ink font-semibold">
          ทีมงานวันนี้ · {summary.present}/{summary.total} มาทำ
        </p>
        <div className="mt-1 flex gap-1" aria-hidden>
          {Array.from({ length: dots }).map((_, i) => (
            <span
              key={i}
              className={`size-2 rounded-full ${i < litDots ? "bg-done" : "bg-edge"}`}
            />
          ))}
        </div>
        {/* Spec 306 — a refusal replaces the outcome the tap promised, so it
            has to be readable here rather than inferred from a board that did
            not change. role="alert" because the button stays enabled and there
            is no other cue that anything happened. */}
        {error ? (
          <p role="alert" className="text-meta text-danger-strong mt-1">
            {error}
          </p>
        ) : null}
      </div>
      {allPresent ? (
        <span className="text-meta text-done-strong shrink-0 font-medium">ครบแล้ว</span>
      ) : (
        <button
          type="button"
          className={`${BUTTON_PRIMARY_COMPACT} shrink-0`}
          disabled={busy}
          onClick={() => mark(summary.pending)}
        >
          ทั้งหมดมาทำ
        </button>
      )}
    </div>
  );
}
