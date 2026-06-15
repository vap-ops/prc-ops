// Spec 108 — desktop grid worklist for procurement (Airtable-style dense table,
// big-screen record review). Presentational server component: rows grouped by
// pipeline band, the item cell links to the record detail (/requests/[id]).
// Phone keeps the spec-104 card pipeline; this renders only at lg+ on the page.
// amount is money — supplied by the page from an admin read, procurement-gated.

import Link from "next/link";
import { StatusPill } from "@/components/features/status-pill";
import { PURCHASE_REQUEST_STATUS_LABEL } from "@/lib/i18n/labels";
import { purchaseRequestStatusPillClasses } from "@/lib/status-colors";
import type { Database } from "@/lib/db/database.types";
import type { ProcurementBandMeta } from "@/lib/purchasing/procurement-pipeline";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

export interface ProcurementGridRow {
  id: string;
  pr_number: number | null;
  item_description: string;
  status: PurchaseRequestStatus;
  eta: string | null;
  supplier: string | null;
  work_package_id: string;
}

const baht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;

export function ProcurementGrid({
  groups,
  wpName,
  amount,
}: {
  groups: ReadonlyArray<{ meta: ProcurementBandMeta; items: ProcurementGridRow[] }>;
  wpName: (wpId: string) => string | null;
  amount: (id: string) => number | null;
}) {
  return (
    <div className="border-edge bg-card shadow-card rounded-card overflow-hidden border">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[42%]" />
          <col className="w-[22%]" />
          <col className="w-[20%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead>
          <tr className="text-ink-muted border-edge text-meta border-b text-left">
            <th className="px-4 py-2 font-normal">รายการ</th>
            <th className="px-2 py-2 font-normal">ผู้ขาย</th>
            <th className="px-2 py-2 font-normal">สถานะ / ETA</th>
            <th className="px-4 py-2 text-right font-normal">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ meta, items }) => (
            <BandRows key={meta.band} meta={meta} items={items} wpName={wpName} amount={amount} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BandRows({
  meta,
  items,
  wpName,
  amount,
}: {
  meta: ProcurementBandMeta;
  items: ProcurementGridRow[];
  wpName: (wpId: string) => string | null;
  amount: (id: string) => number | null;
}) {
  return (
    <>
      <tr className={meta.hot ? "bg-attn-soft" : "bg-sunk"}>
        <td
          colSpan={4}
          className={`text-meta px-4 py-1.5 font-semibold ${
            meta.hot ? "text-attn-ink" : "text-ink-secondary"
          }`}
        >
          {meta.label} · {items.length}
        </td>
      </tr>
      {items.map((r) => {
        const amt = amount(r.id);
        const wp = wpName(r.work_package_id);
        return (
          <tr key={r.id} className="border-edge hover:bg-sunk border-t transition-colors">
            <td className="px-4 py-2 align-top">
              <Link
                href={`/requests/${r.id}`}
                className="text-ink hover:text-action font-medium break-words"
              >
                {r.item_description}
              </Link>
              <div className="text-ink-muted text-meta">
                {r.pr_number ? <span className="font-mono">PR-{r.pr_number}</span> : null}
                {wp ? <span> · {wp}</span> : null}
              </div>
            </td>
            <td className="text-ink-secondary px-2 py-2 align-top break-words">
              {r.supplier ?? "—"}
            </td>
            <td className="px-2 py-2 align-top">
              <StatusPill pillClasses={purchaseRequestStatusPillClasses(r.status)}>
                {PURCHASE_REQUEST_STATUS_LABEL[r.status]}
              </StatusPill>
              {r.eta ? <div className="text-ink-muted text-meta mt-1">ETA {r.eta}</div> : null}
            </td>
            <td className="text-ink px-4 py-2 text-right align-top tabular-nums">
              {amt != null ? baht(amt) : "—"}
            </td>
          </tr>
        );
      })}
    </>
  );
}
