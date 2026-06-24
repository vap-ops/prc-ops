"use client";

// Spec 193 U3 — the super_admin triage control on the feedback review list. A
// segmented set of the four lifecycle statuses; the current one is pressed.
// Tapping a different status relays to setFeedbackStatus (super-only RPC) and
// refreshes the list. Tapping the current status is a no-op.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFeedbackStatus } from "@/app/feedback/review/actions";
import { FEEDBACK_STATUS_LABEL } from "@/lib/i18n/labels";
import { isFeedbackStatus, type FeedbackStatus } from "@/lib/feedback/validate";
import { useToast } from "@/lib/ui/use-toast";

const ORDER: ReadonlyArray<FeedbackStatus> = ["open", "in_progress", "done", "declined"];

export function FeedbackStatusControl({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState<string>(status);

  function choose(next: FeedbackStatus) {
    if (next === current) return;
    startTransition(async () => {
      const result = await setFeedbackStatus(id, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setCurrent(next);
      toast.success("อัปเดตสถานะแล้ว");
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label="สถานะ"
      className="border-edge bg-card rounded-control flex flex-wrap gap-1 border p-1"
    >
      {ORDER.map((s) => {
        const active = s === current;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            disabled={pending}
            onClick={() => isFeedbackStatus(s) && choose(s)}
            className={`rounded-control h-9 flex-1 px-3 text-xs font-semibold whitespace-nowrap transition-colors ${
              active
                ? "bg-fill text-on-fill"
                : "text-ink-secondary hover:bg-sunk focus-visible:ring-action focus:outline-none focus-visible:ring-2"
            }`}
          >
            {FEEDBACK_STATUS_LABEL[s]}
          </button>
        );
      })}
    </div>
  );
}
