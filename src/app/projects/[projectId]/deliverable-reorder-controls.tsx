"use client";

// Spec 165 U2 — ▲▼ reorder controls for a งวด row. 'use client' justified:
// pending state + router.refresh after a swap. Swaps sort_order with the
// immediate neighbour via swapDeliverableOrder (swap_deliverable_order RPC).
// The parent (DeliverablesManager, sorted by sort_order) passes prev/next ids;
// the ends get null → that direction is disabled.

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { swapDeliverableOrder } from "./actions";

const BTN =
  "text-ink-secondary hover:bg-sunk hover:text-ink rounded-control focus-visible:ring-action inline-flex h-8 w-8 shrink-0 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-30";

export function DeliverableReorderControls({
  projectId,
  deliverableId,
  code,
  prevId,
  nextId,
}: {
  projectId: string;
  deliverableId: string;
  code: string;
  prevId: string | null;
  nextId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function swap(otherId: string | null) {
    if (!otherId || pending) return;
    startTransition(async () => {
      const result = await swapDeliverableOrder(projectId, deliverableId, otherId);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label={`เลื่อนงวด ${code} ขึ้น`}
        disabled={!prevId || pending}
        onClick={() => swap(prevId)}
        className={BTN}
      >
        <ChevronUp aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        aria-label={`เลื่อนงวด ${code} ลง`}
        disabled={!nextId || pending}
        onClick={() => swap(nextId)}
        className={BTN}
      >
        <ChevronDown aria-hidden className="size-4" />
      </button>
    </div>
  );
}
