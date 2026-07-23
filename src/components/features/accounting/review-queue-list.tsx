// Spec 345 U2 — the /accounting/review queue rows. Server-renderable, zero
// client JS. Rows are NOT links yet: the voucher page is U3, and a door to a
// route that does not exist is a dead door (spec 313 lesson).

import { Flag } from "lucide-react";
import { EmptyNotice } from "@/components/features/common/notices";
import { formatThaiDate } from "@/lib/i18n/labels";
import { baht } from "@/lib/format";
import { CARD } from "@/lib/ui/classes";
import {
  docsBadgeLabel,
  moneySourceLabel,
  reviewStatusLabel,
  type DocsExpectedClass,
  type MoneySourceTable,
} from "@/lib/accounting/review-queue-view";

export interface ReviewQueueRow {
  sourceTable: MoneySourceTable;
  sourceId: string;
  projectId: string | null;
  projectName: string | null;
  amount: number;
  eventDate: string | null;
  counterparty: string | null;
  docCount: number;
  reviewStatus: "pending" | "flagged" | "verified";
  openFlagCount: number;
  docsExpected: DocsExpectedClass;
}

export function ReviewQueueList({ rows }: { rows: ReviewQueueRow[] }) {
  if (rows.length === 0) {
    return <EmptyNotice>ไม่มีรายการในมุมมองนี้</EmptyNotice>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const docsBadge = docsBadgeLabel(row);
        return (
          <li key={`${row.sourceTable}:${row.sourceId}`} className={CARD}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">
                  {moneySourceLabel(row.sourceTable)}
                </p>
                {row.counterparty ? (
                  <p className="text-muted-foreground truncate text-sm">{row.counterparty}</p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  {row.eventDate ? formatThaiDate(row.eventDate) : "—"}
                  {row.projectName ? ` · ${row.projectName}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-foreground text-sm font-semibold">{baht(row.amount)}</p>
                {row.reviewStatus === "flagged" ? (
                  <p className="bg-danger-soft text-danger mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
                    <Flag aria-hidden className="h-3 w-3" />
                    {reviewStatusLabel("flagged")}
                    {row.openFlagCount > 0 ? ` ${row.openFlagCount}` : ""}
                  </p>
                ) : null}
                {docsBadge ? (
                  <p className="bg-attn-soft text-attn-ink mt-1 inline-block rounded-full px-2 py-0.5 text-xs">
                    {docsBadge}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
