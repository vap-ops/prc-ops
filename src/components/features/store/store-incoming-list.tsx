// Spec 300 U3 — the store's incoming-delivery section (คลัง & ของเข้า). Presentational
// server component: the project's incoming store-bound deliveries, lens-filtered
// (วันนี้/กำลังมา/ทั้งหมด), each row linking to its receive card (/requests/[id]) where the
// delivery photo completes the receipt. No client interactivity — the lens chips and rows
// are links, so no 'use client'.

import Link from "next/link";
import { INCOMING_LENSES, type IncomingLens } from "@/lib/purchasing/request-bands";
import {
  INCOMING_LENS_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  STORE_INCOMING_HEADING,
  STORE_INCOMING_SUBTITLE,
  STORE_INCOMING_EMPTY,
  formatThaiDate,
} from "@/lib/i18n/labels";
import type { StoreIncomingRow } from "@/lib/store/incoming";

// Mirrors requests/page.tsx worklistChipClass (token-only; no raw palette).
function chipClass(active: boolean): string {
  return `focus-visible:ring-action inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-px ${
    active
      ? "border-fill bg-fill text-on-fill font-semibold"
      : "border-edge-strong bg-card text-ink-secondary hover:bg-sunk"
  }`;
}

interface StoreIncomingListProps {
  rows: StoreIncomingRow[];
  lens: IncomingLens;
  /** Builds a store-page href that sets ?incoming=<lens>, preserving the route. */
  hrefFor: (lens: IncomingLens) => string;
}

export function StoreIncomingList({ rows, lens, hrefFor }: StoreIncomingListProps) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-section text-ink font-bold">{STORE_INCOMING_HEADING}</h2>
        <span className="text-meta bg-sunk text-ink-secondary inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-extrabold">
          {rows.length}
        </span>
      </div>
      <p className="text-ink-secondary text-xs">{STORE_INCOMING_SUBTITLE}</p>
      <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label="ตัวกรองการจัดส่ง">
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
      {rows.length === 0 ? (
        <p className="text-ink-secondary text-xs">{STORE_INCOMING_EMPTY}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/requests/${r.id}`}
                className="rounded-card border-edge bg-card shadow-card hover:bg-sunk flex items-center justify-between gap-3 border p-3 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-ink truncate text-sm font-semibold">
                    {r.baseItem}
                    {r.specAttrs ? (
                      <span className="text-ink-secondary font-normal"> {r.specAttrs}</span>
                    ) : null}
                  </p>
                  <p className="text-ink-secondary text-xs">
                    {r.qty} {r.unit}
                    {r.supplier ? ` · ${r.supplier}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-attn-ink text-xs font-medium">
                    {PURCHASE_REQUEST_STATUS_LABEL[r.status]}
                  </span>
                  {r.eta ? (
                    <span
                      className={`text-meta ${r.overdue ? "text-danger font-bold" : "text-ink-secondary"}`}
                    >
                      {r.overdue ? "เลยกำหนด " : ""}
                      {formatThaiDate(r.eta)}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
