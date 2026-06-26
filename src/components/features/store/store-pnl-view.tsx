// Spec 178 U6 — the Store P&L view on /store (super_admin / project_director only).
// Read-only summary of the store as a transfer-pricing BU: per item, what was
// issued at cost vs at the sell (transfer) price → the margin, plus shrinkage from
// physical counts; and the project net = Σ margin + Σ shrinkage. Pure presentational
// component (the page reads store_pnl via the user session, gated by the RPC).

import { STORE_PNL_LABEL } from "@/lib/i18n/labels";
import { bahtWithSymbol as baht } from "@/lib/format";

export type StorePnlRow = {
  catalogItemId: string;
  baseItem: string;
  specAttrs: string | null;
  qtyIssued: number;
  costTotal: number;
  sellTotal: number;
  margin: number;
  shrinkageValue: number;
};

function marginClass(n: number): string {
  if (n > 0) return "text-action text-meta font-semibold shrink-0";
  if (n < 0) return "text-danger text-meta font-semibold shrink-0";
  return "text-ink-muted text-meta font-semibold shrink-0";
}

export function StorePnlView({ rows }: { rows: StorePnlRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-meta text-ink-secondary font-semibold">{STORE_PNL_LABEL}</h2>

      {rows.length === 0 ? (
        <p className="text-ink-secondary text-body">
          ยังไม่มีข้อมูลกำไร-ขาดทุน (ยังไม่มีการเบิกหรือนับสต๊อก)
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li
                key={r.catalogItemId}
                className="border-edge bg-card rounded-control flex flex-col gap-1 border px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-ink text-body min-w-0 font-semibold">
                    {r.baseItem}
                    {r.specAttrs ? (
                      <span className="text-ink-secondary text-meta"> {r.specAttrs}</span>
                    ) : null}
                  </span>
                  <span className={marginClass(r.margin)}>{baht(r.margin)}</span>
                </div>
                <div className="text-ink-secondary text-meta flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>เบิก {r.qtyIssued.toLocaleString("th-TH")}</span>
                  <span>ต้นทุน {baht(r.costTotal)}</span>
                  <span>ยอดขาย {baht(r.sellTotal)}</span>
                  {r.shrinkageValue !== 0 ? (
                    <span className="text-danger">ของขาด-เกิน {baht(r.shrinkageValue)}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <StorePnlTotals rows={rows} />
        </>
      )}
    </section>
  );
}

function StorePnlTotals({ rows }: { rows: StorePnlRow[] }) {
  const totalCost = rows.reduce((s, r) => s + r.costTotal, 0);
  const totalSell = rows.reduce((s, r) => s + r.sellTotal, 0);
  const totalMargin = rows.reduce((s, r) => s + r.margin, 0);
  const totalShrink = rows.reduce((s, r) => s + r.shrinkageValue, 0);
  const net = totalMargin + totalShrink;

  return (
    <div className="border-edge bg-sunk rounded-control flex flex-col gap-1 border px-4 py-3">
      <Row label="ต้นทุนรวม" value={baht(totalCost)} />
      <Row label="ยอดขายรวม" value={baht(totalSell)} />
      <Row label="กำไรขั้นต้น" value={baht(totalMargin)} />
      {totalShrink !== 0 ? <Row label="ของขาด-เกิน" value={baht(totalShrink)} danger /> : null}
      <div className="border-edge mt-1 flex items-baseline justify-between border-t pt-1">
        <span className="text-ink text-body font-semibold">กำไรสุทธิ</span>
        <span className={`text-body font-bold ${net >= 0 ? "text-action" : "text-danger"}`}>
          {baht(net)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-ink-secondary text-meta">{label}</span>
      <span className={`text-meta ${danger ? "text-danger" : "text-ink"}`}>{value}</span>
    </div>
  );
}
