// Spec 325 Phase 1 U2 — presentational view for the per-project cost surface.
// Pure JSX over the U1 read-model (no I/O): two family tiles (ค่าวัสดุ vs
// ค่าดำเนินการ = ค่าแรง + ค่าเช่าอุปกรณ์), then per-WP cards (material + labour)
// sorted by spend. Zero-cost WPs collapse to a count line — 40 ฿0 cards would
// hand the reader a burden (§0). Disclosures per the accounting-drill precedent:
// awaiting-price counts, store pool, multi-project rental — never silently ฿0.

import { CARD, SECTION_HEADING } from "@/lib/ui/classes";
import { bahtWithSymbol } from "@/lib/format";
import { LABOR_BUDGET_LABEL } from "@/lib/i18n/labels";
import type {
  ProjectCostFamilies,
  RentalCostAttribution,
  WpCostRow,
} from "@/lib/costs/wp-cost-breakdown";

interface ProjectCostsViewProps {
  rows: readonly WpCostRow[];
  families: ProjectCostFamilies;
  rental: RentalCostAttribution;
}

export function ProjectCostsView({ rows, families, rental }: ProjectCostsViewProps) {
  // A WP earns a card by carrying any money or an undisclosed-price PR; the
  // rest collapse to one line so the list stays a monitoring view, not a dump.
  const carded = rows
    .filter((r) => r.total !== 0 || r.material.awaitingPriceCount > 0)
    .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  const restCount = rows.length - carded.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Family tiles — the §2 two-family glance. */}
      <div className="grid grid-cols-2 gap-3">
        <div className={CARD}>
          <p className="text-ink-muted text-xs">ค่าวัสดุ</p>
          <p className="text-ink text-lg font-bold tabular-nums">
            {bahtWithSymbol(families.material.total)}
          </p>
          <p className="text-ink-secondary text-meta mt-1">
            ในงาน {bahtWithSymbol(families.material.wpBound)} · พักในคลังโครงการ{" "}
            {bahtWithSymbol(families.material.storePool)}
          </p>
        </div>
        <div className={CARD}>
          <p className="text-ink-muted text-xs">ค่าดำเนินการ</p>
          <p className="text-ink text-lg font-bold tabular-nums">
            {bahtWithSymbol(families.execution.total)}
          </p>
          <p className="text-ink-secondary text-meta mt-1">
            ค่าแรง {bahtWithSymbol(families.execution.labour)} · ค่าเช่าอุปกรณ์{" "}
            {bahtWithSymbol(families.execution.equipment)}
          </p>
        </div>
      </div>

      <div className={CARD}>
        <p className="text-ink-muted text-xs">รวมทั้งโครงการ</p>
        <p className="text-ink text-xl font-extrabold tabular-nums">
          {bahtWithSymbol(families.grand)}
        </p>
        {rental.multiProjectNet > 0 ? (
          <p className="text-attn-ink text-meta mt-1">
            ค่าเช่าที่ใช้ร่วมหลายโครงการ (ยังไม่ปันส่วน) {bahtWithSymbol(rental.multiProjectNet)} —
            ไม่รวมในยอดข้างต้น
          </p>
        ) : null}
        <p className="text-ink-muted text-meta mt-1">
          ค่าวัสดุนับเฉพาะรายการที่บันทึกราคา · ค่าเช่านับจากยอดปิดบิลจริง
        </p>
      </div>

      {/* Per-WP cards. */}
      <section>
        <h2 className={SECTION_HEADING}>ต้นทุนแยกตามงาน</h2>
        <div className="flex flex-col gap-3">
          {carded.map((r) => (
            <div key={r.wpId} data-testid="wp-cost-card" className={CARD}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-ink min-w-0 flex-1 truncate font-semibold">
                  <span className="text-ink-secondary font-mono">{r.code}</span> {r.name ?? ""}
                </p>
                <p className="text-ink shrink-0 font-bold tabular-nums">
                  {bahtWithSymbol(r.total)}
                </p>
              </div>
              <div className="text-meta mt-2 flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-ink-secondary">
                    ค่าวัสดุ
                    {r.material.awaitingPriceCount > 0
                      ? ` · รอราคา ${r.material.awaitingPriceCount} รายการ`
                      : ""}
                  </span>
                  <span className="text-ink tabular-nums">{bahtWithSymbol(r.material.net)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-ink-secondary">
                    ค่าแรง
                    {r.laborBudget !== null
                      ? ` · ${LABOR_BUDGET_LABEL} ${bahtWithSymbol(r.laborBudget)}`
                      : ""}
                  </span>
                  <span className="text-ink tabular-nums">{bahtWithSymbol(r.labour)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="text-ink-secondary text-meta">ยังไม่มีงานในโครงการ</p>
        ) : null}
        {restCount > 0 ? (
          <p className="text-ink-secondary text-meta mt-3">
            อีก {restCount} งานยังไม่มีต้นทุนบันทึก
          </p>
        ) : null}
      </section>
    </div>
  );
}
