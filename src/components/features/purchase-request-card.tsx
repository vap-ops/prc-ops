// Spec 47 — slim clickable request card. The whole card is ONE link to
// /requests/{id}; every action and heavy fact (attachments, uploaders,
// decision/recording zones) lives on the detail page. Server-safe
// presentational component: no 'use client', no handlers — the tracker
// inside is itself server-safe (spec 22), so the card stays a valid
// single-anchor surface.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/features/status-pill";
import { PurchaseRequestTracker } from "@/components/features/purchase-request-tracker";
import {
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import {
  purchaseRequestPriorityPillClasses,
  purchaseRequestStatusPillClasses,
  type PurchaseRequestPriority,
} from "@/lib/status-colors";
import type { Database } from "@/lib/db/database.types";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export interface PurchaseRequestCardRequest {
  id: string;
  pr_number: number;
  item_description: string;
  quantity: number;
  unit: string;
  status: PurchaseRequestStatus;
  priority: PurchaseRequestPriority;
  requested_at: string;
  needed_by: string | null;
  decided_at: string | null;
  purchased_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  eta: string | null;
}

interface PurchaseRequestCardProps {
  request: PurchaseRequestCardRequest;
  workPackage: { code: string; name: string } | null;
  requesterName: string | null;
  isMine: boolean;
}

export function PurchaseRequestCard({
  request,
  workPackage,
  requesterName,
  isMine,
}: PurchaseRequestCardProps) {
  return (
    <Link
      href={`/requests/${request.id}`}
      className="block rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-inset"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          {workPackage ? (
            <p className="truncate text-xs text-zinc-600">
              <span className="font-mono">{workPackage.code}</span>
              <span className="mx-1">·</span>
              {workPackage.name}
            </p>
          ) : null}
          <p className="truncate text-base text-zinc-900">
            {/* PR running number (spec 27) — the phone-callable identity
                for site ↔ procurement talk. */}
            <span className="mr-1.5 font-mono text-xs text-zinc-500">
              PR-{String(request.pr_number).padStart(4, "0")}
            </span>
            {request.item_description}
            <span className="mx-2 text-zinc-400">·</span>
            <span className="text-zinc-700">
              {request.quantity} {request.unit}
            </span>
          </p>
          <p className="text-xs text-zinc-600">
            {/* Own-row marker (spec 25): the viewer's requests must be
                identifiable at a glance in the site-wide list. */}
            {isMine ? (
              <span className="mr-1.5 inline-flex items-center rounded-full border border-blue-700 bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700">
                ของฉัน
              </span>
            ) : null}
            ขอซื้อโดย {requesterName ?? "—"}
            <span className="mx-1 text-zinc-400">·</span>
            ขอเมื่อ {formatThaiDate(request.requested_at)}
          </p>
          {request.needed_by ? (
            <p className="text-xs text-zinc-600">
              ต้องการรับของภายใน {formatThaiDate(request.needed_by)}
            </p>
          ) : null}
        </div>
        <span className="flex shrink-0 items-start gap-1.5">
          <span className="flex flex-col items-end gap-1">
            <StatusPill pillClasses={purchaseRequestStatusPillClasses(request.status)}>
              {PURCHASE_REQUEST_STATUS_LABEL[request.status]}
            </StatusPill>
            {request.priority !== "normal" ? (
              <StatusPill pillClasses={purchaseRequestPriorityPillClasses(request.priority)}>
                {PURCHASE_REQUEST_PRIORITY_LABEL[request.priority]}
              </StatusPill>
            ) : null}
          </span>
          <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-zinc-400" />
        </span>
      </div>
      <div className="mt-3">
        <PurchaseRequestTracker
          status={request.status}
          requestedAt={request.requested_at}
          decidedAt={request.decided_at}
          purchasedAt={request.purchased_at}
          shippedAt={request.shipped_at}
          deliveredAt={request.delivered_at}
          eta={request.eta}
        />
      </div>
    </Link>
  );
}
