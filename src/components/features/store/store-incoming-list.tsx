// Spec 300 U3 / 305 / 307 / 308 — the ของเข้า incoming list. Spec 307: the grain
// is the ARRIVAL (ETA day × supplier), because the quick one-line-PO flow made the
// spec-305 delivery grain degenerate to one card per PR item. Day sections carry
// the date + how many packages arrive that day; a card ≈ one expected truck. Spec
// 308: receiving is a per-delivery action, so an arrival keeps its items grouped
// by delivery — each real delivery shows a รับของ link to its receive page.
// Spec 307 U2: รับของ is the ONLY action — item rows are a plain manifest (no
// deep-link into the จัดซื้อ /requests page, procurement's surface), and the store
// (คลัง) symbol marks the surface + the action so the SA learns ของเข้า → คลัง.
// Presentational server component — links only, no 'use client'.

import Link from "next/link";
import { Box } from "lucide-react";
import { INCOMING_LENSES, type IncomingLens } from "@/lib/purchasing/request-bands";
import {
  INCOMING_LENS_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  STORE_INCOMING_HEADING,
  STORE_INCOMING_SUBTITLE,
  STORE_INCOMING_EMPTY,
  STORE_INCOMING_DAY_TODAY,
  STORE_INCOMING_DAY_UNSCHEDULED,
  DELIVERY_LENS_FILTER_ARIA,
  DELIVERY_OVERDUE_FLAG,
  UNKNOWN_SUPPLIER_LABEL,
  DELIVERY_RECEIVE_PAGE_TITLE,
  STORE_LABEL,
  storeIncomingCountAria,
  storeIncomingDayCountAria,
  formatThaiDate,
} from "@/lib/i18n/labels";
import type { IncomingDayGroup, StoreIncomingRow } from "@/lib/store/incoming";

// Spec 307 U2 — the store (คลัง) symbol. The SA's store tile (sa-tools) marks คลัง
// with lucide `Box` + the text-cat-w05 accent; reusing it here teaches the SA that
// ของเข้า feeds คลัง — received goods become store stock. Labelled คลัง (not
// aria-hidden) so the symbol is announced, not silent.
function StoreSymbol({ className = "" }: { className?: string }) {
  return (
    <Box
      role="img"
      aria-label={STORE_LABEL}
      data-testid="incoming-store-symbol"
      className={`text-cat-w05 ${className}`}
    />
  );
}

// Mirrors requests/page.tsx worklistChipClass (token-only; no raw palette).
function chipClass(active: boolean): string {
  return `focus-visible:ring-action inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px ${
    active
      ? "border-fill bg-fill text-on-fill font-semibold"
      : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
  }`;
}

// The count chip the top badge and the day headers reuse. A bare number is
// meaningless to a screen reader, so the caller passes a distinct accessible name
// (total incoming vs a single day's shipments).
function countChip(n: number, ariaLabel: string) {
  return (
    <span
      aria-label={ariaLabel}
      className="text-meta bg-sunk text-ink-secondary inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-extrabold"
    >
      {n}
    </span>
  );
}

function dayLabel(day: IncomingDayGroup): string {
  if (day.day == null) return STORE_INCOMING_DAY_UNSCHEDULED;
  const date = formatThaiDate(day.day);
  if (day.isToday) return `${STORE_INCOMING_DAY_TODAY} · ${date}`;
  if (day.overdue) return `${DELIVERY_OVERDUE_FLAG} · ${date}`;
  return date;
}

// Spec 307 U2 — a PR line row is a plain MANIFEST entry, NOT a link. Receiving is
// the only action on ของเข้า (the รับของ link); the SA never deep-links into the
// จัดซื้อ page (/requests) — that is procurement's surface (spec 304/308 doctrine).
function ItemRow({ r }: { r: StoreIncomingRow }) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 py-2">
      <p className="text-ink min-w-0 truncate text-sm">
        {r.baseItem}
        {r.specAttrs ? <span className="text-ink-secondary"> {r.specAttrs}</span> : null}
      </p>
      <span className="text-ink-secondary shrink-0 text-xs">
        {r.qty} {r.unit}
      </span>
    </li>
  );
}

interface StoreIncomingListProps {
  days: IncomingDayGroup[];
  lens: IncomingLens;
  /** Builds a store-page href that sets ?incoming=<lens>, preserving the route. */
  hrefFor: (lens: IncomingLens) => string;
  /** Spec 308: builds the delivery-receive-page href — when set, a รับของ action
   *  renders on each delivery within an arrival. */
  receiveHrefFor?: (deliveryId: string) => string;
}

export function StoreIncomingList({ days, lens, hrefFor, receiveHrefFor }: StoreIncomingListProps) {
  // Spec 307: the badge counts ARRIVAL CARDS — it must match the cards below.
  const totalArrivals = days.reduce((n, d) => n + d.arrivals.length, 0);
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        {/* Spec 307 U2: the store symbol marks ของเข้า as part of the คลัง world. */}
        <h2 className="text-section text-ink flex items-center gap-1.5 font-bold">
          <StoreSymbol className="size-5 shrink-0" />
          {STORE_INCOMING_HEADING}
        </h2>
        {countChip(totalArrivals, storeIncomingCountAria(totalArrivals))}
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
      {totalArrivals === 0 ? (
        <p className="text-ink-secondary text-xs">{STORE_INCOMING_EMPTY}</p>
      ) : (
        days.map((day) => (
          <section key={day.day ?? "noeta"} className="flex flex-col gap-2">
            <div className="mt-1 flex items-center gap-2">
              <h3 className={`text-sm font-semibold ${day.overdue ? "text-danger" : "text-ink"}`}>
                {dayLabel(day)}
              </h3>
              {/* How many packages that day — the number the operator asked for. */}
              {countChip(day.arrivals.length, storeIncomingDayCountAria(day.arrivals.length))}
            </div>
            <ul className="flex flex-col gap-2">
              {day.arrivals.map((g) => (
                <li key={g.key} className="rounded-card border-edge bg-card shadow-card border p-3">
                  <div className="flex items-center justify-between gap-3">
                    {/* Count lives OUTSIDE the truncating node — a long supplier name
                        must not clip the multi-item signal. */}
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <p className="text-ink min-w-0 truncate text-sm font-semibold">
                        {g.supplier ?? UNKNOWN_SUPPLIER_LABEL}
                      </p>
                      {g.itemCount > 1 ? (
                        <span className="text-ink-secondary shrink-0 text-sm">
                          · {g.itemCount} รายการ
                        </span>
                      ) : null}
                    </div>
                    <span className="text-attn-ink shrink-0 text-xs font-medium">
                      {PURCHASE_REQUEST_STATUS_LABEL[g.status]}
                    </span>
                  </div>
                  {/* Spec 308: receiving is per delivery. Each real delivery in the
                      arrival gets its own รับของ link (one for the common single
                      delivery, more when a supplier ships several the same day). */}
                  {g.deliveries.map((d, i) => (
                    <div key={d.deliveryId ?? `nodelivery-${i}`}>
                      {receiveHrefFor && d.deliveryId ? (
                        <Link
                          href={receiveHrefFor(d.deliveryId)}
                          className="text-action mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline"
                        >
                          {/* The store symbol on the action: รับของ stocks the คลัง. */}
                          <StoreSymbol className="size-4 shrink-0" />
                          {DELIVERY_RECEIVE_PAGE_TITLE} →
                        </Link>
                      ) : null}
                      <ul className="border-edge divide-edge mt-1 flex flex-col divide-y border-t">
                        {d.items.map((r) => (
                          <ItemRow key={r.id} r={r} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
