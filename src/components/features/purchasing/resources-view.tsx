// Spec 327 U5 — the ทรัพยากร view body (presentational, server component).
// Material coverage per WP (ในคลัง / กำลังมา / ยังไม่สั่งซื้อ item splits with
// the missing items NAMED — §0.2), the project bucket for null-WP plan lines
// (§0.1), no-plan WPs as create-plan doors (§0.3), the equipment period rows
// (amber gap + rental door), and the D6 dashed labor slot. Grain captions per
// §0.5 — stock is project-grain, plans are approved-only.

import Link from "next/link";

import { EmptyNotice } from "@/components/features/common/notices";
import {
  INCOMING_LENS_LABEL,
  NO_PLAN_LABEL,
  PURCHASE_ORDER_STATUS_LABEL,
  formatThaiDate,
} from "@/lib/i18n/labels";
import { withBackFrom } from "@/lib/nav/back-href";
import { supplyPlanHref } from "@/lib/nav/project-paths";
import type { NamedItem, WpCoverage } from "@/lib/purchasing/wp-material-coverage";

const RESOURCES_FROM = "/procurement/resources";
const NOT_ORDERED = PURCHASE_ORDER_STATUS_LABEL.open; // ยังไม่สั่งซื้อ (SSOT :590)

export interface CoverageRow {
  wp: { id: string; code: string; name: string };
  coverage: WpCoverage;
}

export interface RentalRow {
  id: string;
  startsOn: string | null;
  endsOn: string | null;
  gap: boolean;
}

function itemName(i: NamedItem): string {
  return i.specAttrs ? `${i.baseItem} ${i.specAttrs}` : i.baseItem;
}

function CoverageChips({ coverage }: { coverage: WpCoverage }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {coverage.inStock > 0 ? (
        <span className="bg-done-soft text-done-ink text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
          ในคลัง {coverage.inStock}
        </span>
      ) : null}
      {coverage.incoming > 0 ? (
        <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
          {INCOMING_LENS_LABEL.onroute} {coverage.incoming}
        </span>
      ) : null}
      {coverage.notOrdered > 0 ? (
        <span className="bg-attn-soft text-attn-ink text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
          {NOT_ORDERED} {coverage.notOrdered}
        </span>
      ) : null}
    </div>
  );
}

function NotOrderedNames({ items }: { items: ReadonlyArray<NamedItem> }) {
  if (items.length === 0) return null;
  return (
    <p className="text-attn-ink text-meta">
      {NOT_ORDERED}: {items.map(itemName).join(" · ")}
    </p>
  );
}

export function ResourcesBody({
  projectId,
  coverageRows,
  projectBucket,
  noPlanWps,
  rentals,
  projectEnd,
}: {
  projectId: string;
  coverageRows: ReadonlyArray<CoverageRow>;
  projectBucket: WpCoverage;
  noPlanWps: ReadonlyArray<{ id: string; code: string; name: string }>;
  rentals: ReadonlyArray<RentalRow>;
  projectEnd: string | null;
}) {
  const planDoor = withBackFrom(supplyPlanHref(projectId), RESOURCES_FROM);
  return (
    <div className="flex flex-col gap-4">
      {/* วัสดุ — coverage at plan grain. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-body text-ink-secondary font-semibold">วัสดุ</h3>
        {/* §0.5 grain honesty: BOTH the stock pool and the incoming set are
            PROJECT grain — two WPs planning the same item read the same pool,
            and an in-transit truck earmarked for one WP reads กำลังมา on every
            WP planning that item. Only APPROVED plans count. */}
        <p className="text-ink-muted text-meta">
          สต็อกและของกำลังมานับที่ระดับโครงการ · เฉพาะแผนจัดหาที่อนุมัติแล้ว ·
          นับเป็นจำนวนรายการวัสดุ
        </p>

        {coverageRows.length === 0 && projectBucket.plannedItems === 0 ? (
          <EmptyNotice>
            ยังไม่มีแผนจัดหาที่อนุมัติ —{" "}
            <Link href={planDoor} className="text-action underline">
              เปิดแผนจัดหา
            </Link>
          </EmptyNotice>
        ) : null}

        {projectBucket.plannedItems > 0 ? (
          <div className="rounded-card shadow-card border-edge bg-sunk flex flex-col gap-2 border px-4 py-3">
            <span className="text-body text-ink font-semibold">คลัง · ระดับโครงการ</span>
            <CoverageChips coverage={projectBucket} />
            <NotOrderedNames items={projectBucket.notOrderedItems} />
          </div>
        ) : null}

        {coverageRows.map(({ wp, coverage }) => (
          <div
            key={wp.id}
            className="rounded-card shadow-card border-edge bg-card flex flex-col gap-2 border px-4 py-3"
          >
            <span className="text-body text-ink flex min-w-0 items-center gap-2 font-semibold">
              <span className="text-ink-muted shrink-0 font-mono text-xs">{wp.code}</span>
              <span className="min-w-0 flex-1 truncate">{wp.name}</span>
            </span>
            <CoverageChips coverage={coverage} />
            <NotOrderedNames items={coverage.notOrderedItems} />
          </div>
        ))}

        {noPlanWps.length > 0 ? (
          <details className="rounded-card border-edge bg-card border px-4 py-3">
            <summary className="text-body text-ink-secondary min-h-11 cursor-pointer font-semibold">
              {NO_PLAN_LABEL} ({noPlanWps.length})
            </summary>
            <div className="mt-2 flex flex-col gap-1">
              {noPlanWps.map((wp) => (
                <div key={wp.id} className="flex min-h-11 items-center gap-2">
                  <span className="text-ink-muted shrink-0 font-mono text-xs">{wp.code}</span>
                  <span className="text-meta text-ink-secondary min-w-0 flex-1 truncate">
                    {wp.name}
                  </span>
                  <Link
                    href={planDoor}
                    className="border-edge text-ink-secondary hover:bg-sunk text-meta inline-flex min-h-11 shrink-0 items-center rounded-full border px-3"
                  >
                    {NO_PLAN_LABEL} →
                  </Link>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      {/* อุปกรณ์ — rental periods at PROJECT grain (allocations are
          project-bound; WP grain has no join — 323 D6). */}
      <section className="flex flex-col gap-2">
        <h3 className="text-body text-ink-secondary font-semibold">อุปกรณ์เช่า</h3>
        {rentals.length === 0 ? (
          <EmptyNotice>
            ไม่มีอุปกรณ์เช่าที่ยังใช้งานในโครงการนี้ —{" "}
            <Link
              href={withBackFrom("/equipment/rentals", RESOURCES_FROM)}
              className="text-action underline"
            >
              เปิดหน้าเช่าอุปกรณ์
            </Link>
          </EmptyNotice>
        ) : (
          rentals.map((r) => (
            <div
              key={r.id}
              className={`rounded-card shadow-card bg-card flex min-h-11 flex-wrap items-center gap-2 border px-4 py-3 ${
                r.gap ? "border-attn-edge" : "border-edge"
              }`}
            >
              <span className="text-body text-ink min-w-0 flex-1">
                {r.startsOn ? formatThaiDate(r.startsOn) : "—"} –{" "}
                {r.endsOn ? formatThaiDate(r.endsOn) : "ไม่มีกำหนดสิ้นสุด"}
              </span>
              {r.gap && projectEnd ? (
                <span className="bg-attn-soft text-attn-ink text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                  หมดก่อนจบโครงการ ({formatThaiDate(projectEnd)})
                </span>
              ) : null}
              <Link
                href={withBackFrom(`/equipment/rentals?project=${projectId}`, RESOURCES_FROM)}
                className="border-edge text-ink-secondary hover:bg-sunk text-meta inline-flex min-h-11 shrink-0 items-center rounded-full border px-3"
              >
                เช่าอุปกรณ์ →
              </Link>
            </div>
          ))
        )}
      </section>

      {/* แรงงาน — D6: deferred HONESTLY (roster empty, muster adoption pending).
          Dashed slot, no fake data, no hidden slot. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-body text-ink-secondary font-semibold">แรงงาน</h3>
        <p className="border-edge text-ink-muted text-meta rounded-card border border-dashed px-4 py-3">
          รอข้อมูลทีมช่าง (เฟสถัดไป)
        </p>
      </section>
    </div>
  );
}
