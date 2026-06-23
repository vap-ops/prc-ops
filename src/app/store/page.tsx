// Spec 177 U2 — /store: the on-site store surface. Pick a project, see its on-hand
// stock (qty + value + derived moving-average cost), and record a stock-in
// (รับเข้า) at cost. A settings drill-down (DetailHeader back → /settings, no
// HubNav), gated to BACK_OFFICE_ROLES — the cost-bearing curators (PM/super/
// procurement/director), mirroring /catalog. The store is per-project; the picker
// is RLS-scoped (procurement sees all, PM sees member projects).

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import {
  StoreManager,
  type CatalogPick,
  type CountRow,
  type IssueRow,
  type ReceiptRow,
  type StockRow,
} from "@/components/features/store/store-manager";
import { StorePnlView, type StorePnlRow } from "@/components/features/store/store-pnl-view";
import { STORE_LABEL } from "@/lib/i18n/labels";

interface PageProps {
  searchParams: Promise<{ project?: string }>;
}

export const metadata = { title: STORE_LABEL };

export default async function StorePage({ searchParams }: PageProps) {
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const { project } = await searchParams;
  const supabase = await createClient();

  // Projects the viewer can see (RLS: procurement = all, PM/SA = members,
  // super/director = all). This is the store picker.
  const { data: projRows } = await supabase
    .from("projects")
    .select("id, code, name")
    .order("code", { ascending: true });
  const projects = (projRows ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name }));

  // Only honour a project the viewer can actually see; else no selection.
  const selectedProjectId = project && projects.some((p) => p.id === project) ? project : null;

  // เบิก (issue-out) is gated to the manager tier (PM/super/director) — the
  // intersection of /store access (BACK_OFFICE) and the issue_stock RPC gate
  // (SITE_STAFF). Procurement reaches /store but cannot issue; site_admin can
  // issue but draws at the WP detail (a later unit), not here.
  const canIssue = isManagerRole(ctx.role);

  // Store P&L (the margin view) is gated to super_admin / project_director — the
  // store_pnl RPC's money gate (mirrors wp_profit). Procurement/PM never see it.
  const canSeePnl = ctx.role === "super_admin" || ctx.role === "project_director";

  let onHand: StockRow[] = [];
  let pnlRows: StorePnlRow[] = [];
  let catalogItems: CatalogPick[] = [];
  let suppliers: { id: string; name: string }[] = [];
  let workPackages: { id: string; code: string; name: string }[] = [];
  let workers: { id: string; name: string }[] = [];
  let issues: IssueRow[] = [];
  let receipts: ReceiptRow[] = [];
  let counts: CountRow[] = [];

  if (selectedProjectId) {
    const { data: ohRows } = await supabase
      .from("stock_on_hand")
      .select(
        "catalog_item_id, qty_on_hand, total_value, catalog_items ( base_item, spec_attrs, unit )",
      )
      .eq("project_id", selectedProjectId);
    onHand = (ohRows ?? [])
      .map((r) => ({
        catalogItemId: r.catalog_item_id,
        baseItem: r.catalog_items?.base_item ?? "",
        specAttrs: r.catalog_items?.spec_attrs ?? null,
        unit: r.catalog_items?.unit ?? "",
        qtyOnHand: Number(r.qty_on_hand),
        totalValue: Number(r.total_value),
      }))
      .sort((a, b) => a.baseItem.localeCompare(b.baseItem, "th"));

    const { data: catRows } = await supabase
      .from("catalog_items")
      .select("id, category, base_item, spec_attrs, unit")
      .eq("is_active", true)
      .order("base_item", { ascending: true });
    catalogItems = (catRows ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      baseItem: r.base_item,
      specAttrs: r.spec_attrs,
      unit: r.unit,
    }));

    const { data: supRows } = await supabase
      .from("suppliers")
      .select("id, name")
      .order("name", { ascending: true });
    suppliers = (supRows ?? []).map((s) => ({ id: s.id, name: s.name }));

    const { data: wpRows } = await supabase
      .from("work_packages")
      .select("id, code, name")
      .eq("project_id", selectedProjectId)
      .order("code", { ascending: true });
    workPackages = (wpRows ?? []).map((w) => ({ id: w.id, code: w.code, name: w.name }));

    // Spec 178 B4 — project workers for the optional custody receiver picker on a
    // /store เบิก (managers can now name a receiver, like the WP-detail draw).
    const { data: workerRows } = await supabase
      .from("workers")
      .select("id, name")
      .eq("project_id", selectedProjectId)
      .eq("active", true)
      .order("name", { ascending: true });
    workers = (workerRows ?? []).map((w) => ({ id: w.id, name: w.name }));

    const { data: issueRows } = await supabase
      .from("stock_issues")
      .select(
        "id, qty, unit, unit_cost, receiver_worker_id, received_at, catalog_items ( base_item, spec_attrs ), work_packages ( code, name )",
      )
      .eq("project_id", selectedProjectId)
      .order("issued_at", { ascending: false })
      .limit(10);
    issues = (issueRows ?? []).map((r) => ({
      id: r.id,
      baseItem: r.catalog_items?.base_item ?? "",
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      unit: r.unit,
      qty: Number(r.qty),
      unitCost: Number(r.unit_cost),
      wpLabel: r.work_packages ? `${r.work_packages.code} ${r.work_packages.name}` : "",
      receiverWorkerId: r.receiver_worker_id,
      receivedAt: r.received_at,
    }));

    // Recent รับเข้า — the reversal targets (spec 177 U12).
    const { data: receiptRows } = await supabase
      .from("stock_receipts")
      .select("id, qty, unit, unit_cost, catalog_items ( base_item, spec_attrs )")
      .eq("project_id", selectedProjectId)
      .order("received_at", { ascending: false })
      .limit(10);
    receipts = (receiptRows ?? []).map((r) => ({
      id: r.id,
      baseItem: r.catalog_items?.base_item ?? "",
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      unit: r.unit,
      qty: Number(r.qty),
      unitCost: Number(r.unit_cost),
    }));

    // Recent physical counts — the ประวัติการนับ audit trail (spec 178 B3).
    const { data: countRows } = await supabase
      .from("stock_counts")
      .select("id, counted_qty, variance, unit, catalog_items ( base_item, spec_attrs )")
      .eq("project_id", selectedProjectId)
      .order("counted_at", { ascending: false })
      .limit(10);
    counts = (countRows ?? []).map((r) => ({
      id: r.id,
      baseItem: r.catalog_items?.base_item ?? "",
      specAttrs: r.catalog_items?.spec_attrs ?? null,
      unit: r.unit,
      countedQty: Number(r.counted_qty),
      variance: Number(r.variance),
    }));

    if (canSeePnl) {
      // store_pnl is a definer RPC with a super/director gate → call on the user
      // session (the JWT resolves the gate). It keys on catalog_item_id; resolve
      // names separately (covers items that were since deactivated).
      const { data: pnl } = await supabase.rpc("store_pnl", { p_project_id: selectedProjectId });
      const ids = (pnl ?? []).map((r) => r.catalog_item_id);
      const nameMap = new Map<string, { base_item: string; spec_attrs: string | null }>();
      if (ids.length > 0) {
        const { data: nameRows } = await supabase
          .from("catalog_items")
          .select("id, base_item, spec_attrs")
          .in("id", ids);
        for (const n of nameRows ?? []) nameMap.set(n.id, n);
      }
      pnlRows = (pnl ?? [])
        .map((r) => {
          const meta = nameMap.get(r.catalog_item_id);
          return {
            catalogItemId: r.catalog_item_id,
            baseItem: meta?.base_item ?? "",
            specAttrs: meta?.spec_attrs ?? null,
            qtyIssued: Number(r.qty_issued),
            costTotal: Number(r.cost_total),
            sellTotal: Number(r.sell_total),
            margin: Number(r.margin),
            shrinkageValue: Number(r.shrinkage_value),
          };
        })
        .sort((a, b) => a.baseItem.localeCompare(b.baseItem, "th"));
    }
  }

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{STORE_LABEL}</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <StoreManager
          projects={projects}
          selectedProjectId={selectedProjectId}
          onHand={onHand}
          catalogItems={catalogItems}
          suppliers={suppliers}
          canIssue={canIssue}
          workPackages={workPackages}
          workers={workers}
          issues={issues}
          receipts={receipts}
          counts={counts}
        />
        {selectedProjectId && canSeePnl ? <StorePnlView rows={pnlRows} /> : null}
      </div>
    </PageShell>
  );
}
