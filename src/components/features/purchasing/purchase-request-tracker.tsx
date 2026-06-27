// Spec 22 — order-tracking stepper shown on every /requests card.
//
// Server-safe presentational component (no 'use client'): pure render of
// row fields, no state, no handlers. The five lifecycle stages are always
// visible in order; status decides how far the fill reaches. rejected is
// a terminal branch rendered AT the decision stage (red), with the
// downstream stages muted — the pipeline never pretends a rejected
// request is still moving.
//
// Spec 111: the stage-state logic lives in src/lib/purchasing/order-stages.ts
// (shared with the grid mini-bar). This component renders it with labels +
// dates. data-stage / data-state attributes are the test contract (spec 22).

import { formatThaiDate } from "@/lib/i18n/labels";
import type { Database } from "@/lib/db/database.types";
import { ORDER_STAGES, orderStageStates, type OrderStage } from "@/lib/purchasing/order-stages";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

interface PurchaseRequestTrackerProps {
  status: PurchaseRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  purchasedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  eta: string | null;
}

const STAGE_LABEL: Record<OrderStage, string> = {
  requested: "ส่งคำขอ",
  approved: "อนุมัติ",
  purchased: "สั่งซื้อ",
  on_route: "กำลังจัดส่ง",
  delivered: "ได้รับของ",
};

export function PurchaseRequestTracker({
  status,
  requestedAt,
  decidedAt,
  purchasedAt,
  shippedAt,
  deliveredAt,
  eta,
}: PurchaseRequestTrackerProps) {
  const steps = orderStageStates(status);
  const stageDate: Record<OrderStage, string | null> = {
    requested: requestedAt,
    approved: decidedAt,
    purchased: purchasedAt,
    on_route: shippedAt,
    delivered: deliveredAt,
  };

  return (
    <ol aria-label="สถานะคำขอซื้อ" className="flex items-start">
      {steps.map((step, i) => {
        const { stage, state, isCurrent, reached } = step;
        const date = stageDate[stage];
        const label = state === "rejected" ? "ไม่อนุมัติ" : STAGE_LABEL[stage];
        // Connector RIGHT of this dot is filled when the next stage is done.
        const nextDone = steps[i + 1]?.state === "done";
        // Ring marks the live step, but never the rejected terminal (red dot).
        const ringCurrent = isCurrent && state !== "rejected";

        const dotClass =
          state === "done"
            ? "border-done-strong bg-done-strong"
            : state === "rejected"
              ? "border-danger bg-danger"
              : "border-edge-strong bg-card";
        const labelClass =
          state === "rejected"
            ? "text-danger"
            : state === "cancelled"
              ? "text-ink-muted"
              : state === "done"
                ? "text-ink"
                : "text-ink-secondary";

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
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${dotClass} ${
                  ringCurrent ? "ring-done ring-2" : ""
                }`}
              >
                {state === "done" ? (
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-none stroke-white stroke-2">
                    <path d="M2 5.2 4.2 7.4 8 3" />
                  </svg>
                ) : state === "rejected" ? (
                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-none stroke-white stroke-2">
                    <path d="M3 3l4 4M7 3l-4 4" />
                  </svg>
                ) : null}
              </span>
              <span
                aria-hidden
                className={`h-0.5 flex-1 ${
                  i === ORDER_STAGES.length - 1
                    ? "invisible"
                    : nextDone
                      ? "bg-done-strong"
                      : "bg-edge"
                }`}
              />
            </span>
            <span
              className={`mt-1 text-center text-xs leading-snug font-medium ${labelClass} ${
                isCurrent ? "font-semibold" : ""
              }`}
            >
              {label}
            </span>
            {state === "done" && i > 0 ? (
              <span className="text-ink-secondary text-center text-xs">
                {date ? formatThaiDate(date) : "—"}
              </span>
            ) : null}
            {stage === "delivered" && state === "pending" && eta ? (
              <span className="text-ink-secondary text-center text-xs">
                คาดว่า {formatThaiDate(eta)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
