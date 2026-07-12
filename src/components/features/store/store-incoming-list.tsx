// Spec 300 U3 / 305 — the ของเข้า incoming list. Spec 305: one card per DELIVERY
// (งวดส่ง) — a delivery naturally carries many PR lines, so lines sharing a
// delivery_id group into one arrival with its items listed inside; each item
// still links to its receive card (/requests/[id]) where the delivery photo
// completes the receipt. Presentational server component — links only, no
// 'use client'.

import Link from "next/link";
import { INCOMING_LENSES, type IncomingLens } from "@/lib/purchasing/request-bands";
import {
  INCOMING_LENS_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  STORE_INCOMING_HEADING,
  STORE_INCOMING_SUBTITLE,
  STORE_INCOMING_EMPTY,
  DELIVERY_LENS_FILTER_ARIA,
  DELIVERY_OVERDUE_FLAG,
  UNKNOWN_SUPPLIER_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import type { IncomingDeliveryGroup } from "@/lib/store/incoming";

// Mirrors requests/page.tsx worklistChipClass (token-only; no raw palette).
function chipClass(active: boolean): string {
  return `focus-visible:ring-action inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px ${
    active
      ? "border-fill bg-fill text-on-fill font-semibold"
      : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
  }`;
}

interface StoreIncomingListProps {
  deliveries: IncomingDeliveryGroup[];
  lens: IncomingLens;
  /** Builds a store-page href that sets ?incoming=<lens>, preserving the route. */
  hrefFor: (lens: IncomingLens) => string;
}

export function StoreIncomingList({ deliveries, lens, hrefFor }: StoreIncomingListProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-section text-ink font-bold">{STORE_INCOMING_HEADING}</h2>
        {/* Spec 305: the badge counts DELIVERIES — it must match the cards below. */}
        <span className="text-meta bg-sunk text-ink-secondary inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-extrabold">
          {deliveries.length}
        </span>
      </div>
      <p className="text-ink-secondary text-xs">{STORE_INCOMING_SUBTITLE}</p>
      <div
        className="flex flex-wrap gap-1 text-xs"
        role="group"
        aria-label={DELIVERY_LENS_FILTER_ARIA}
      >
        {INCOMING_LENSES.map((l) => (
          <Link
            key={l}
            href={hrefFor(l)}
            aria-current={l === lens ? "true" : undefined}
            className={chipClass(l === lens)}
          >
            {INCOMING_LENS_LABEL[l]}
          </Link>
        ))}
      </div>
      {deliveries.length === 0 ? (
        <p className="text-ink-secondary text-xs">{STORE_INCOMING_EMPTY}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {deliveries.map((g) => (
            <li key={g.key} className="rounded-card border-edge bg-card shadow-card border p-3">
              <div className="flex items-center justify-between gap-3">
                {/* Count lives OUTSIDE the truncating node — a long supplier name
                    must not clip the multi-item signal. */}
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <p className="text-ink min-w-0 truncate text-sm font-semibold">
                    {g.supplier ?? UNKNOWN_SUPPLIER_LABEL}
                  </p>
                  {g.items.length > 1 ? (
                    <span className="text-ink-secondary shrink-0 text-sm">
                      · {g.items.length} รายการ
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-attn-ink text-xs font-medium">
                    {PURCHASE_REQUEST_STATUS_LABEL[g.status]}
                  </span>
                  {g.eta ? (
                    <span
                      className={`text-meta ${g.overdue ? "text-danger font-bold" : "text-ink-secondary"}`}
                    >
                      {g.overdue ? `${DELIVERY_OVERDUE_FLAG} ` : ""}
                      {formatThaiDate(g.eta)}
                    </span>
                  ) : null}
                </div>
              </div>
              <ul className="border-edge divide-edge mt-2 flex flex-col divide-y border-t">
                {g.items.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/requests/${r.id}`}
                      className="hover:bg-sunk flex min-h-11 items-center justify-between gap-3 py-2 transition-colors"
                    >
                      <p className="text-ink min-w-0 truncate text-sm">
                        {r.baseItem}
                        {r.specAttrs ? (
                          <span className="text-ink-secondary"> {r.specAttrs}</span>
                        ) : null}
                      </p>
                      <span className="text-ink-secondary shrink-0 text-xs">
                        {r.qty} {r.unit}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
