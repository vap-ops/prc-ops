// Spec 361 U8 — /catalog/units: curate the managed หน่วยนับ vocabulary.
//
// Two parents, hence safeBackHref: the /catalog taxonomy row (added in this
// unit — without it project_manager / project_director, whom this page and all
// three RPCs admit, would have no door at all) and the ข้อมูลหลัก hub. Gated to
// BACK_OFFICE_ROLES, the same allowlist the three catalog_unit RPCs carry. Until this unit the table
// (spec 223 / ADR 0066) could only be curated by SQL.
//
// Reads: the FULL unit list (inactive included — retiring one must stay
// visible and reversible) plus one `unit` value per active catalog item, folded
// into usage counts by splitUnitUsage. PostgREST cannot GROUP BY, so the units
// come back one row per item — and this project's `db-max-rows` is **1000**
// (probed live), which the catalog will cross. A truncated read would silently
// under-count usage and make off-list strings vanish, with no error, so the
// read is PAGED to exhaustion rather than taking one page and hoping.

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

// One page below the server's 1000-row ceiling, so a short page always means
// "that was the last one" and the loop terminates on real exhaustion.
const UNIT_SCAN_PAGE = 500;

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function readAllItemUnits(supabase: SupabaseServerClient): Promise<Array<string | null>> {
  const units: Array<string | null> = [];
  for (let page = 0; ; page += 1) {
    const from = page * UNIT_SCAN_PAGE;
    const { data, error } = await supabase
      .from("catalog_items")
      .select("unit")
      .eq("is_active", true)
      .order("id", { ascending: true })
      .range(from, from + UNIT_SCAN_PAGE - 1);
    if (error || !data) break;
    units.push(...data.map((r) => r.unit));
    if (data.length < UNIT_SCAN_PAGE) break;
  }
  return units;
}

export default async function CatalogUnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  const [{ data: unitRows }, itemUnits] = await Promise.all([
    supabase
      .from("catalog_units")
      // No embed for the adder: catalog_units.created_by FKs auth.users, not
      // public.users, so PostgREST has no relation to traverse — the names are
      // resolved in a second read below.
      .select(
        "code, display_name, abbr_short, unit_class, sort_order, is_active, created_at, created_by",
      )
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true }),
    readAllItemUnits(supabase),
  ]);

  // created_by is NULL on every spec-223 seeded row, so it separates "seeded"
  // from "someone added this in the app" exactly. The adder's name is a
  // nice-to-have: if this read is refused the chip still renders, unnamed.
  const adderIds = [
    ...new Set((unitRows ?? []).map((r) => r.created_by).filter((id) => id !== null)),
  ];
  const adderNames = new Map<string, string>();
  if (adderIds.length > 0) {
    const { data: adders } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", adderIds);
    for (const a of adders ?? []) if (a.full_name) adderNames.set(a.id, a.full_name);
  }

  const managedRows: ManagedUnit[] = (unitRows ?? []).map((r) => ({
    code: r.code,
    displayName: r.display_name,
    abbrShort: r.abbr_short,
    unitClass: r.unit_class,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    addedBy: r.created_by ? { name: adderNames.get(r.created_by) ?? null, at: r.created_at } : null,
  }));
  const { managed, offList } = splitUnitUsage(managedRows, itemUnits);

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
