// Spec 213 U2 — material activity log (ประวัติวัสดุ). One material's full life in
// a project's store: current on-hand status + a newest-first timeline of every
// movement (รับเข้า / เบิก / ตรวจนับ / คืน / แก้รายการ), assembled from the five
// append-only movement tables. Reached by tapping a row on the store on-hand list
// (U3). Read for WP_DETAIL_ROLES; RLS scopes to project members. Cost-side only —
// sell/margin (store_pnl) is not surfaced here (spec 213 money rule).

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { MaterialLogView } from "@/components/features/store/material-log-view";
import { loadCategoryCodeById } from "@/lib/work-categories/load-category-codes";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { WP_DETAIL_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { storeHref } from "@/lib/nav/project-paths";
import { safeBackHref } from "@/lib/nav/back-href";
import { buildMaterialLog, type MaterialLogSources } from "@/lib/store/material-log";
import { loadCatalogCategories, categoryNameById } from "@/lib/catalog/categories";
import { baht } from "@/lib/format";
import { MATERIAL_LOG_LABEL, STORE_LABEL } from "@/lib/i18n/labels";

interface PageProps {
  params: Promise<{ projectId: string; catalogItemId: string }>;
  searchParams: Promise<{ from?: string }>;
}

export const metadata = { title: MATERIAL_LOG_LABEL };

const num = (v: number | string | null): number => (v == null ? 0 : Number(v));
const numOrNull = (v: number | string | null): number | null => (v == null ? null : Number(v));

export default async function MaterialLogPage({ params, searchParams }: PageProps) {
  const { projectId, catalogItemId } = await params;
  const { from } = await searchParams;
  const ctx = await requireRole(WP_DETAIL_ROLES);
  const supabase = await createClient();

  // RLS scopes the project to those the caller can see; the id pins prevent a
  // cross-project leak. A hidden/absent project or unknown item 404s. Spec 221
  // cleanup — the category is shown by its managed name (via category_id), not
  // the vestigial item_category enum.
  const [{ data: project }, { data: item }, { data: onHandRow }, categories] = await Promise.all([
    supabase.from("projects").select("id, code, name").eq("id", projectId).maybeSingle(),
    supabase
      .from("catalog_items")
      .select("id, base_item, spec_attrs, unit, category_id")
      .eq("id", catalogItemId)
      .maybeSingle(),
    supabase
      .from("stock_on_hand")
      .select("qty_on_hand, total_value")
      .eq("project_id", projectId)
      .eq("catalog_item_id", catalogItemId)
      .maybeSingle(),
    loadCatalogCategories(supabase),
  ]);
  if (!project || !item) notFound();

  const categoryName = item.category_id
    ? (categoryNameById(categories).get(item.category_id) ?? null)
    : null;

  const where = { project_id: projectId, catalog_item_id: catalogItemId };
  const [
    { data: receipts },
    { data: issues },
    { data: counts },
    { data: returns },
    { data: reversals },
  ] = await Promise.all([
    supabase
      .from("stock_receipts")
      .select(
        "id, qty, unit_cost, total_cost, received_at, created_at, created_by, note, suppliers ( name )",
      )
      .match(where),
    supabase
      .from("stock_issues")
      // Spec 301 U3: + category_id for the letter-code reconcile below.
      .select(
        "id, qty, unit_cost, total_cost, issued_at, created_at, issued_by, note, work_packages ( code, name, category_id )",
      )
      .match(where),
    supabase
      .from("stock_counts")
      .select(
        "id, counted_qty, system_qty, variance, variance_value, counted_at, created_at, counted_by, note",
      )
      .match(where),
    supabase
      .from("stock_returns")
      .select(
        "id, qty, total_cost, returned_at, created_at, returned_by, note, work_packages ( code, name, category_id )",
      )
      .match(where),
    supabase
      .from("stock_reversals")
      .select(
        "id, qty, value_delta, receipt_id, issue_id, reversed_at, created_at, reversed_by, note",
      )
      .match(where),
  ]);

  // Spec 301 U3: batch-reconcile the movement WPs' categories → W0x codes for
  // the letter-code render (member-visible page → user client; a viewer who
  // can't read project_categories degrades to the raw code).
  const movementCategoryIds = [
    ...new Set(
      [...(issues ?? []), ...(returns ?? [])]
        .map((r) => r.work_packages?.category_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const categoryCodeById = await loadCategoryCodeById(supabase, movementCategoryIds);
  const wpRef = (wp: { code: string; name: string; category_id: string | null } | null) =>
    wp
      ? {
          code: wp.code,
          name: wp.name,
          categoryCode: wp.category_id ? (categoryCodeById.get(wp.category_id) ?? null) : null,
        }
      : null;

  const sources: MaterialLogSources = {
    receipts: (receipts ?? []).map((r) => ({
      id: r.id,
      at: r.received_at,
      createdAt: r.created_at,
      qty: num(r.qty),
      unitCost: numOrNull(r.unit_cost),
      totalCost: numOrNull(r.total_cost),
      actorId: r.created_by,
      note: r.note,
      supplierName: r.suppliers?.name ?? null,
    })),
    issues: (issues ?? []).map((i) => ({
      id: i.id,
      at: i.issued_at,
      createdAt: i.created_at,
      qty: num(i.qty),
      unitCost: numOrNull(i.unit_cost),
      totalCost: numOrNull(i.total_cost),
      actorId: i.issued_by,
      note: i.note,
      workPackage: wpRef(i.work_packages),
    })),
    counts: (counts ?? []).map((c) => ({
      id: c.id,
      at: c.counted_at,
      createdAt: c.created_at,
      countedQty: num(c.counted_qty),
      systemQty: num(c.system_qty),
      variance: num(c.variance),
      varianceValue: numOrNull(c.variance_value),
      actorId: c.counted_by,
      note: c.note,
    })),
    returns: (returns ?? []).map((rt) => ({
      id: rt.id,
      at: rt.returned_at,
      createdAt: rt.created_at,
      qty: num(rt.qty),
      totalCost: numOrNull(rt.total_cost),
      actorId: rt.returned_by,
      note: rt.note,
      workPackage: wpRef(rt.work_packages),
    })),
    reversals: (reversals ?? []).map((rv) => ({
      id: rv.id,
      at: rv.reversed_at,
      createdAt: rv.created_at,
      qty: num(rv.qty),
      valueDelta: numOrNull(rv.value_delta),
      reverses: rv.receipt_id ? ("receipt" as const) : ("issue" as const),
      actorId: rv.reversed_by,
      note: rv.note,
    })),
  };

  const log = buildMaterialLog(sources);

  // The item is not in this project's store if it has neither an on-hand row nor
  // any movement — 404 rather than render an empty page for an arbitrary item id.
  if (!onHandRow && log.length === 0) notFound();

  const qtyOnHand = num(onHandRow?.qty_on_hand ?? null);
  const totalValue = num(onHandRow?.total_value ?? null);
  const avgCost = qtyOnHand > 0 ? totalValue / qtyOnHand : 0;
  const specSuffix = item.spec_attrs ? ` · ${item.spec_attrs}` : "";

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader
        backHref={safeBackHref(from, storeHref(projectId))}
        backLabel={`กลับไป${STORE_LABEL}`}
      >
        <div>
          <p className="text-meta text-ink-secondary">
            {MATERIAL_LOG_LABEL}
            {categoryName ? ` · ${categoryName}` : ""}
          </p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            {item.base_item}
            {specSuffix}
          </h1>
        </div>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        {/* Current status — cost-side (mirrors what the store console already shows). */}
        <div className="border-edge bg-card shadow-card rounded-card flex flex-col gap-2 border p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-ink-secondary text-meta font-semibold">คงเหลือในคลัง</span>
            <span className="text-ink text-title font-bold tabular-nums">
              {qtyOnHand} {item.unit}
            </span>
          </div>
          <div className="border-edge text-meta flex items-baseline justify-between border-t pt-2">
            <span className="text-ink-secondary">ต้นทุนเฉลี่ย</span>
            <span className="text-ink font-semibold tabular-nums">
              {baht(avgCost)} / {item.unit} · รวม {baht(totalValue)}
            </span>
          </div>
        </div>

        <MaterialLogView entries={log} unit={item.unit} />
      </section>
    </PageShell>
  );
}
