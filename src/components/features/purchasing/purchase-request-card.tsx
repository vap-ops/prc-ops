// Spec 47 — slim clickable request card. The whole card is ONE link to
// /requests/{id}; every action and heavy fact (attachments, uploaders,
// decision/recording zones) lives on the detail page. Server-safe
// presentational component: no 'use client', no handlers — the tracker
// inside is itself server-safe (spec 22), so the card stays a valid
// single-anchor surface.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusIconBadge, StatusPill } from "@/components/features/common/status-pill";
import { PurchaseRequestTracker } from "@/components/features/purchasing/purchase-request-tracker";
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
import { purchaseRequestPriorityIcon, purchaseRequestStatusIcon } from "@/lib/status-icons";
import { formatPrNumber } from "@/lib/purchasing/format-id";
import { PoNumberTag } from "@/components/features/purchasing/po-number-tag";
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
  // Spec 211 U5: the PO this request belongs to (null = loose). Shown as a chip so
  // PO membership is visible in every band, not only the in_transit PO group.
  poNumber?: number | null;
}

export function PurchaseRequestCard({
  request,
  workPackage,
  requesterName,
  isMine,
  poNumber = null,
}: PurchaseRequestCardProps) {
  return (
    <Link
      href={`/requests/${request.id}`}
      className="rounded-card border-edge bg-card shadow-card hover:bg-page focus-visible:ring-action active:bg-sunk block border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          {workPackage ? (
            <p className="text-ink-secondary truncate text-xs">
              <span className="font-mono">{workPackage.code}</span>
              <span className="mx-1">·</span>
              {workPackage.name}
            </p>
          ) : null}
          {poNumber != null ? (
            <p className="text-xs">
              <PoNumberTag poNumber={poNumber} />
            </p>
          ) : null}
          <p className="text-ink text-base break-words">
            {/* PR running number (spec 27) — the phone-callable identity
                for site ↔ procurement talk. Feedback 30a1a520: the name
                WRAPS (Thai is never clipped mid-word) — the status pill
                that used to crush it is icon-only now. */}
            <span className="text-ink-muted mr-1.5 font-mono text-xs">
              {formatPrNumber(request.pr_number)}
            </span>
            {request.item_description}
            <span className="text-ink-muted mx-2">·</span>
            <span className="text-ink-secondary">
              {request.quantity} {request.unit}
            </span>
          </p>
          <p className="text-ink-secondary text-xs">
            {/* Own-row marker (spec 25): the viewer's requests must be
                identifiable at a glance in the site-wide list. */}
            {isMine ? (
              <span className="border-action bg-action-soft text-action mr-1.5 inline-flex items-center rounded-full border px-1.5 text-[10px] font-semibold">
                ของฉัน
              </span>
            ) : null}
            ขอซื้อโดย {requesterName ?? "—"}
            <span className="text-ink-muted mx-1">·</span>
            ขอเมื่อ {formatThaiDate(request.requested_at)}
          </p>
          {request.needed_by ? (
            <p className="text-ink-secondary text-xs">
              ต้องการรับของภายใน {formatThaiDate(request.needed_by)}
            </p>
          ) : null}
        </div>
        <span className="flex shrink-0 items-start gap-1.5">
          <span className="flex flex-col items-end gap-1">
            {/* Feedback 30a1a520: status is icon-only — the text pill crushed
                the item name and duplicated the tracker below. Colour trio +
                glyph carry the state; the Thai label stays for screen readers. */}
            <StatusIconBadge
              pillClasses={purchaseRequestStatusPillClasses(request.status)}
              icon={purchaseRequestStatusIcon(request.status)}
              label={PURCHASE_REQUEST_STATUS_LABEL[request.status]}
            />
            {request.priority !== "normal" ? (
              <StatusPill
                pillClasses={purchaseRequestPriorityPillClasses(request.priority)}
                icon={purchaseRequestPriorityIcon(request.priority)}
              >
                {PURCHASE_REQUEST_PRIORITY_LABEL[request.priority]}
              </StatusPill>
            ) : null}
          </span>
          <ChevronRight aria-hidden className="text-ink-muted mt-1 size-4 shrink-0" />
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
