// Spec 213 U2 — the per-material activity log. Presentational (no client state):
// renders an assembled MaterialLogEntry[] as a newest-first timeline. Cost-side
// only — sell/margin never reaches this component (spec 213 money rule).

import {
  PackagePlus,
  PackageMinus,
  ClipboardCheck,
  Undo2,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { baht } from "@/lib/format";
import {
  formatThaiDate,
  STORE_RECEIVE_LABEL,
  STORE_ISSUE_LABEL,
  STOCK_COUNT_LABEL,
  STORE_RETURN_TO_STORE_LABEL,
  STORE_FIX_WRONG_ENTRY_LABEL,
  RECEIPT_CORRECTION_PENDING_LABEL,
} from "@/lib/i18n/labels";
import type { MaterialLogEntry, MaterialLogKind } from "@/lib/store/material-log";
import { WpCategoryCode } from "@/components/features/work-packages/wp-category-code";

// Each kind reuses its existing store-action label (SSOT) + a glyph. The icon
// hue follows on-hand direction: inflow lifts stock, outflow draws it down.
const KIND_META: Record<MaterialLogKind, { label: string; Icon: LucideIcon; inflow: boolean }> = {
  receipt: { label: STORE_RECEIVE_LABEL, Icon: PackagePlus, inflow: true },
  issue: { label: STORE_ISSUE_LABEL, Icon: PackageMinus, inflow: false },
  count: { label: STOCK_COUNT_LABEL, Icon: ClipboardCheck, inflow: true },
  return: { label: STORE_RETURN_TO_STORE_LABEL, Icon: Undo2, inflow: true },
  reversal: { label: STORE_FIX_WRONG_ENTRY_LABEL, Icon: RotateCcw, inflow: true },
};

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function MaterialLogView({
  entries,
  unit,
  // Spec 324 U6: receipt ids with a PENDING correction flag → the receipt entry
  // shows ⚠ รอแก้ไข (a back-office correction is awaited).
  flaggedReceiptIds = [],
}: {
  entries: MaterialLogEntry[];
  unit: string;
  flaggedReceiptIds?: string[];
}) {
  const flagged = new Set(flaggedReceiptIds);
  if (entries.length === 0) {
    return (
      <p className="border-edge bg-card text-ink-secondary rounded-control border px-4 py-6 text-center text-sm">
        ยังไม่มีความเคลื่อนไหวของวัสดุนี้
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => {
        const meta = KIND_META[e.kind];
        const Icon = meta.Icon;
        return (
          <li
            key={e.id}
            className="border-edge bg-card rounded-control flex items-start gap-3 border p-3"
          >
            <span
              aria-hidden
              className={`mt-0.5 shrink-0 ${meta.inflow ? "text-action" : "text-ink-secondary"}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-ink text-body font-semibold">
                  {meta.label}
                  {e.kind === "receipt" && flagged.has(e.id) ? (
                    <span className="bg-attn-soft text-attn-ink text-meta ml-2 inline-block rounded-full px-2 py-0.5 font-medium">
                      {RECEIPT_CORRECTION_PENDING_LABEL}
                    </span>
                  ) : null}
                </span>
                <span className="text-ink text-body shrink-0 font-bold tabular-nums">
                  {signed(e.qtyDelta)} {unit}
                </span>
              </div>
              <div className="text-ink-secondary text-meta mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>{formatThaiDate(e.at)}</span>
                {e.cost != null ? <span>· {baht(e.cost)}</span> : null}
                {e.workPackage ? (
                  <span>
                    ·{" "}
                    <WpCategoryCode
                      code={e.workPackage.code}
                      categoryCode={e.workPackage.categoryCode ?? null}
                    />{" "}
                    {e.workPackage.name}
                  </span>
                ) : null}
                {e.supplierName ? <span>· {e.supplierName}</span> : null}
                {e.count ? (
                  <span>
                    · นับได้ {e.count.countedQty} (ระบบ {e.count.systemQty})
                  </span>
                ) : null}
                <span className="tabular-nums">
                  · คงเหลือ {e.balanceAfter} {unit}
                </span>
              </div>
              {e.note ? <p className="text-ink-muted text-meta mt-0.5">{e.note}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
