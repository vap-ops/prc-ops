// Spec 22 — order-tracking stepper shown on every /requests card.
//
// Server-safe presentational component (no 'use client'): pure render of
// row fields, no state, no handlers. The five lifecycle stages are always
// visible in order; status decides how far the fill reaches. rejected is
// a terminal branch rendered AT the decision stage (red), with the
// downstream stages muted — the pipeline never pretends a rejected
// request is still moving.
//
// data-stage / data-state attributes are the test contract (spec 22) —
// they also make the stepper greppable in devtools on a phone.

import type { Database } from "@/lib/db/database.types";
import { formatThaiDate } from "@/lib/i18n/labels";

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

const STAGES = ["requested", "approved", "purchased", "on_route", "delivered"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABEL: Record<Stage, string> = {
  requested: "ส่งคำขอ",
  approved: "อนุมัติ",
  purchased: "สั่งซื้อ",
  on_route: "กำลังจัดส่ง",
  delivered: "ได้รับของ",
};

// How far along the pipeline each status reaches (index into STAGES).
// rejected reaches the decision stage (index 1) and terminates there;
// cancelled (spec 27) also stops after the decision stage but keeps the
// approve stage green — it was approved, then administratively closed.
const STATUS_RANK: Record<PurchaseRequestStatus, number> = {
  requested: 0,
  approved: 1,
  rejected: 1,
  cancelled: 1,
  purchased: 2,
  on_route: 3,
  delivered: 4,
  // Spec 66 / ADR 0043: an on-site purchase didn't walk this requisition
  // pipeline; the detail page hides the stepper for it. Ranked terminal
  // (goods received) for the type's sake if it ever renders.
  site_purchased: 4,
};

type StepState = "done" | "pending" | "rejected" | "cancelled";

export function PurchaseRequestTracker({
  status,
  requestedAt,
  decidedAt,
  purchasedAt,
  shippedAt,
  deliveredAt,
  eta,
}: PurchaseRequestTrackerProps) {
  const rank = STATUS_RANK[status];
  const rejected = status === "rejected";
  const cancelled = status === "cancelled";
  const stageDate: Record<Stage, string | null> = {
    requested: requestedAt,
    approved: decidedAt,
    purchased: purchasedAt,
    on_route: shippedAt,
    delivered: deliveredAt,
  };

  return (
    <ol aria-label="สถานะการสั่งซื้อ" className="flex items-start">
      {STAGES.map((stage, i) => {
        const state: StepState = rejected
          ? i < 1
            ? "done"
            : i === 1
              ? "rejected"
              : "cancelled"
          : cancelled
            ? i <= rank
              ? "done"
              : "cancelled"
            : i <= rank
              ? "done"
              : "pending";
        const isCurrent = rejected ? i === 1 : i === rank;
        const date = stageDate[stage];
        const label = rejected && stage === "approved" ? "ไม่อนุมัติ" : STAGE_LABEL[stage];
        // Connector segment LEFT of this dot is filled when this step has
        // been reached (done or the rejected terminal).
        const reached = state === "done" || state === "rejected";

        const dotClass =
          state === "done"
            ? "border-emerald-700 bg-emerald-700"
            : state === "rejected"
              ? "border-red-600 bg-red-600"
              : "border-zinc-400 bg-white";
        const labelClass =
          state === "rejected"
            ? "text-red-700"
            : state === "cancelled"
              ? "text-zinc-400"
              : state === "done"
                ? "text-zinc-900"
                : "text-zinc-600";

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
                className={`h-0.5 flex-1 ${i === 0 ? "invisible" : reached ? "bg-emerald-700" : "bg-zinc-300"}`}
              />
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${dotClass} ${
                  isCurrent && !rejected ? "ring-2 ring-emerald-200" : ""
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
                  i === STAGES.length - 1
                    ? "invisible"
                    : !rejected && i < rank
                      ? "bg-emerald-700"
                      : "bg-zinc-300"
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
              <span className="text-center text-xs text-zinc-600">
                {date ? formatThaiDate(date) : "—"}
              </span>
            ) : null}
            {stage === "delivered" && state === "pending" && !rejected && eta ? (
              <span className="text-center text-xs text-zinc-600">
                คาดว่า {formatThaiDate(eta)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
