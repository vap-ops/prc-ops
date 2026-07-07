// Spec 134 U6 — the PO-level progress stepper: สั่งซื้อ → จัดส่ง → รับของ. Shown on
// the PO detail so the order's progress (incl. the delivering stage that the
// roll-up now surfaces, ADR 0044 amendment) is visible at a glance. Server-safe
// presentational component (no 'use client'): pure render of the derived status.
// Mirrors the per-ticket PurchaseRequestTracker (spec 22) geometry.

import {
  purchaseOrderStageStates,
  type PurchaseOrderStage,
  type PurchaseOrderStatus,
} from "@/lib/purchasing/purchase-order";
import { RECEIVE_TO_STORE_LABEL } from "@/lib/i18n/labels";
import { purchaseOrderStatusIcon } from "@/lib/status-icons";

const STAGE_LABEL: Record<PurchaseOrderStage, string> = {
  ordered: "สั่งซื้อ",
  in_transit: "จัดส่ง",
  // Feedback a4e37ccd: arrival = into the project store (คลัง), not "from the shop".
  received: RECEIVE_TO_STORE_LABEL,
};

export function PurchaseOrderTracker({ status }: { status: PurchaseOrderStatus }) {
  const steps = purchaseOrderStageStates(status);

  return (
    <ol aria-label="ความคืบหน้าใบสั่งซื้อ" className="flex items-start">
      {steps.map((step, i) => {
        const { stage, state, partial } = step;
        const reached = state === "done" || state === "current";
        const isCurrent = state === "current";
        const nextDone = steps[i + 1]?.state === "done";

        const dotClass =
          state === "done" ? "border-done-strong bg-done-strong" : "border-edge-strong bg-card";
        const labelClass = state === "pending" ? "text-ink-secondary" : "text-ink";
        // The stage's own SSOT glyph (FileText → Truck → PackageCheck) — the same
        // icons the PO status pill uses. Previews (muted) on upcoming stages so the
        // truck is visible at the จัดส่ง step regardless of progress.
        const StageIcon = purchaseOrderStatusIcon(stage);
        const iconTone =
          state === "done" ? "text-white" : state === "current" ? "text-ink" : "text-ink-muted";

        return (
          <li
            key={stage}
            data-stage={stage}
            data-state={state}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center"
          >
            <span className="flex w-full items-center">
              <span
                aria-hidden
                className={`h-0.5 flex-1 ${i === 0 ? "invisible" : reached ? "bg-done-strong" : "bg-edge"}`}
              />
              <span
                aria-hidden
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${dotClass} ${
                  isCurrent ? "ring-done ring-2" : ""
                }`}
              >
                <StageIcon className={`h-4 w-4 ${iconTone}`} />
              </span>
              <span
                aria-hidden
                className={`h-0.5 flex-1 ${
                  i === steps.length - 1 ? "invisible" : nextDone ? "bg-done-strong" : "bg-edge"
                }`}
              />
            </span>
            <span
              className={`mt-1 text-center text-xs leading-snug font-medium ${labelClass} ${
                isCurrent ? "font-semibold" : ""
              }`}
            >
              {STAGE_LABEL[stage]}
            </span>
            {stage === "received" && partial ? (
              <span className="text-ink-secondary text-center text-xs">บางส่วน</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
