// Spec 361 U8 — /catalog/units: curate the managed หน่วยนับ vocabulary.
//
// A /catalog drill (DetailHeader back → /catalog unless ?from says otherwise —
// the ข้อมูลหลัก hub links here too), gated to BACK_OFFICE_ROLES, which is the
// same allowlist the three catalog_unit RPCs carry. Until this unit the table
// (spec 223 / ADR 0066) could only be curated by SQL.
//
// Reads: the FULL unit list (inactive included — retiring one must stay
// visible and reversible) plus one `unit` value per active catalog item, folded
// into usage counts by splitUnitUsage. The item read is a single text column
// over ~600 rows; PostgREST cannot GROUP BY, and the count is what makes
// retiring a unit an informed decision.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { UnitsBoard } from "@/components/features/catalog/units-board";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { safeBackHref } from "@/lib/nav/back-href";
import { splitUnitUsage, type ManagedUnit } from "@/lib/catalog/units-curation";
import { CATALOG_LABEL, CATALOG_UNITS_HINT, CATALOG_UNITS_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: CATALOG_UNITS_LABEL };

export default async function CatalogUnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const [{ data: unitRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from("catalog_units")
      .select("code, display_name, abbr_short, unit_class, sort_order, is_active")
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true }),
    supabase.from("catalog_items").select("unit").eq("is_active", true),
  ]);

  const managedRows: ManagedUnit[] = (unitRows ?? []).map((r) => ({
    code: r.code,
    displayName: r.display_name,
    abbrShort: r.abbr_short,
    unitClass: r.unit_class,
    sortOrder: r.sort_order,
    isActive: r.is_active,
  }));
  const { managed, offList } = splitUnitUsage(
    managedRows,
    (itemRows ?? []).map((r) => r.unit),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/catalog")} backLabel={CATALOG_LABEL}>
        <h1 className="text-title text-ink font-bold tracking-tight">{CATALOG_UNITS_LABEL}</h1>
        <p className="text-ink-secondary text-meta">{CATALOG_UNITS_HINT}</p>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <UnitsBoard managed={managed} offList={offList} />
      </div>
    </PageShell>
  );
}
