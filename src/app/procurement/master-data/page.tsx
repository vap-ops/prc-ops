// Spec 361 U4 — /procurement/master-data: the ข้อมูลหลัก index. A leaf of the
// STR hub (spec 323 decision A: a door is an unlit leaf; the DetailHeader back
// chip + the hub tab are the way back), gated to the same set as the hub itself.
//
// Every count is read with the CALLER's RLS client — all eleven tables carry a
// SELECT policy that admits both procurement tiers (verified live 2026-07-26),
// so no admin client is needed and a count that comes back null renders as no
// number rather than a misleading 0.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { MasterDataBoard } from "@/components/features/purchasing/master-data-board";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { safeBackHref } from "@/lib/nav/back-href";
import { MASTER_DATA_HINT, MASTER_DATA_LABEL } from "@/lib/i18n/labels";
import type { MasterDataCounts } from "@/lib/purchasing/master-data";
import { PROCUREMENT_HOME_ROLES } from "../hub-body";

export const metadata = { title: MASTER_DATA_LABEL };

// Split by whether the table carries is_active — the two unions keep `.eq` type-safe.
type ActiveFlaggedTable =
  | "catalog_items"
  | "catalog_units"
  | "work_categories"
  | "office_expense_categories";

type PlainTable =
  | "catalog_categories"
  | "wp_templates"
  | "equipment_items"
  | "equipment_categories"
  | "worker_level_rates"
  | "suppliers"
  | "contractors";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// A failed count reads as "unknown", never as 0 — the board renders no number
// rather than telling her a populated list is empty.
async function countActive(
  supabase: SupabaseServerClient,
  table: ActiveFlaggedTable,
): Promise<number | null> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  return error ? null : (count ?? null);
}

async function countAll(supabase: SupabaseServerClient, table: PlainTable): Promise<number | null> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  return error ? null : (count ?? null);
}

export default async function MasterDataPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole([...PROCUREMENT_HOME_ROLES]);
  const supabase = await createClient();

  const [
    catalogItems,
    catalogCategories,
    catalogUnits,
    orderingTemplates,
    equipmentItems,
    equipmentCategories,
    workCategories,
    workerLevelRates,
    expenseCategories,
    suppliers,
    contractors,
  ] = await Promise.all([
    countActive(supabase, "catalog_items"),
    countAll(supabase, "catalog_categories"),
    countActive(supabase, "catalog_units"),
    countAll(supabase, "wp_templates"),
    countAll(supabase, "equipment_items"),
    countAll(supabase, "equipment_categories"),
    countActive(supabase, "work_categories"),
    countAll(supabase, "worker_level_rates"),
    countActive(supabase, "office_expense_categories"),
    countAll(supabase, "suppliers"),
    countAll(supabase, "contractors"),
  ]);
  const counts: MasterDataCounts = {
    catalogItems,
    catalogCategories,
    catalogUnits,
    orderingTemplates,
    equipmentItems,
    equipmentCategories,
    workCategories,
    workerLevelRates,
    expenseCategories,
    suppliers,
    contractors,
  };

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/procurement/resources")} backLabel="ทรัพยากร">
        <h1 className="text-title text-ink font-bold tracking-tight">{MASTER_DATA_LABEL}</h1>
        <p className="text-ink-secondary text-meta">{MASTER_DATA_HINT}</p>
      </DetailHeader>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <MasterDataBoard
          counts={counts}
          from="/procurement/master-data"
          isManager={ctx.role === "procurement_manager" || ctx.role === "super_admin"}
        />
      </section>
    </PageShell>
  );
}
