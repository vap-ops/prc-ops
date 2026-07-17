// FB-4620 — line-level loader for the enriched itemized purchase export
// (/requests/reports/export-itemized). Each purchase_requests row is already one
// ordered line (item_description, quantity, unit, catalog_item_id, amount), so the
// "itemized" export is those lines with their labels resolved — no separate
// line table.
//
// PARITY (deliberate, not loadPurchaseRegister): this must select the SAME
// purchase set as the summary purchase_report RPC so the two exports reconcile —
// the SPEND statuses only, purchased_at not null, and the Asia/Bangkok business-day
// window (the +07:00 offset makes `${to}T23:59:59.999+07:00` equal the RPC's
// `(purchased_at at time zone 'Asia/Bangkok')::date between from and to`; proven
// equal on live data). loadPurchaseRegister applies NO status filter and windows in
// naive UTC by design (its /accounting drill shows all-status rows), so reusing it
// would over-include cancelled/rejected PRs and mis-bucket rows near Bangkok
// midnight. Reads via the admin client behind requireRole(PURCHASE_REPORT_ROLES) —
// the register/journal-export pattern; purchase_requests RLS otherwise excludes
// accounting.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { PurchaseLineExportRow } from "@/lib/purchasing/purchase-line-export";
import { SPEND_STATUSES } from "@/lib/dashboard/spend";

type Admin = SupabaseClient<Database>;
type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

// PostgREST caps a single response at its "Max rows" setting (Supabase default
// 1000). A year-preset / busy-period export can exceed that, so a plain .select()
// would SILENTLY truncate and hand procurement an incomplete item list. Page every
// read to exhaustion (PAGE ≤ the cap so a short page reliably signals "done"), and
// batch id lists so a long .in(...) never trips a URL-length limit (414) — the
// load-journal-export.ts pattern.
const PAGE = 1000;
const ID_BATCH = 300;

type LineRow = {
  pr_number: number;
  purchased_at: string | null;
  needed_by: string | null;
  delivered_at: string | null;
  item_description: string;
  catalog_item_id: string | null;
  quantity: number;
  unit: string;
  amount: number | null;
  vat_rate: number;
  supplier_id: string | null;
  supplier: string | null;
  project_id: string | null;
  purchase_order_id: string | null;
  work_package_id: string | null;
  status: string;
};

async function fetchLineRows(
  admin: Admin,
  from: string,
  to: string,
  projectId?: string,
): Promise<LineRow[]> {
  const out: LineRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = admin
      .from("purchase_requests")
      .select(
        "pr_number, purchased_at, needed_by, delivered_at, item_description, catalog_item_id, quantity, unit, amount, vat_rate, supplier_id, supplier, project_id, purchase_order_id, work_package_id, status",
      )
      .in("status", [...SPEND_STATUSES] as PurchaseRequestStatus[])
      .not("purchased_at", "is", null)
      // Asia/Bangkok business-day window (parity with purchase_report — see file head).
      .gte("purchased_at", `${from}T00:00:00+07:00`)
      .lte("purchased_at", `${to}T23:59:59.999+07:00`)
      .order("purchased_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (projectId) q = q.eq("project_id", projectId);
    const { data, error } = await q;
    if (error) throw new Error(`purchase_requests(line-export): ${error.message}`);
    out.push(...((data as LineRow[] | null) ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// Resolve a label map over a (possibly large) distinct id list — batched so a long
// .in(...) never trips PostgREST's URL-length limit (414). Each batch returns ≤
// ID_BATCH rows (one per id), so it never approaches the row cap and needs no
// per-batch paging.
async function idMap<V>(
  ids: string[],
  fetchBatch: (batch: string[]) => Promise<Array<{ id: string; value: V }>>,
): Promise<Map<string, V>> {
  const map = new Map<string, V>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += ID_BATCH) {
    const rows = await fetchBatch(unique.slice(i, i + ID_BATCH));
    for (const r of rows) map.set(r.id, r.value);
  }
  return map;
}

const nonNull = (id: string | null): id is string => id !== null;

export async function loadPurchaseLineItems(
  admin: Admin,
  from: string,
  to: string,
  projectId?: string,
): Promise<PurchaseLineExportRow[]> {
  const rows = await fetchLineRows(admin, from, to, projectId);
  if (rows.length === 0) return [];

  const [projects, suppliers, pos, catalog] = await Promise.all([
    idMap(rows.map((r) => r.project_id).filter(nonNull), async (batch) => {
      const { data } = await admin.from("projects").select("id, code, name").in("id", batch);
      return (data ?? []).map((p) => ({
        id: p.id,
        value: { name: p.name ?? p.code, code: p.code },
      }));
    }),
    idMap(rows.map((r) => r.supplier_id).filter(nonNull), async (batch) => {
      const { data } = await admin.from("suppliers").select("id, name").in("id", batch);
      return (data ?? []).map((s) => ({ id: s.id, value: s.name }));
    }),
    idMap(rows.map((r) => r.purchase_order_id).filter(nonNull), async (batch) => {
      const { data } = await admin.from("purchase_orders").select("id, po_number").in("id", batch);
      return (data ?? []).map((p) => ({ id: p.id, value: p.po_number }));
    }),
    idMap(rows.map((r) => r.catalog_item_id).filter(nonNull), async (batch) => {
      const { data } = await admin
        .from("catalog_items")
        .select("id, base_item, category_id")
        .in("id", batch);
      return (data ?? []).map((c) => ({
        id: c.id,
        value: { baseItem: c.base_item, categoryId: c.category_id },
      }));
    }),
  ]);

  // Categories resolve one hop past the catalog items (catalog_item_id ->
  // category_id -> catalog_categories); WPs from the line's work_package_id.
  const [categories, wps] = await Promise.all([
    idMap([...catalog.values()].map((c) => c.categoryId).filter(nonNull), async (batch) => {
      const { data } = await admin
        .from("catalog_categories")
        .select("id, name, code")
        .in("id", batch);
      return (data ?? []).map((c) => ({ id: c.id, value: { name: c.name, code: c.code } }));
    }),
    idMap(rows.map((r) => r.work_package_id).filter(nonNull), async (batch) => {
      const { data } = await admin.from("work_packages").select("id, name, code").in("id", batch);
      return (data ?? []).map((w) => ({ id: w.id, value: { name: w.name, code: w.code } }));
    }),
  ]);

  return rows.map((r) => {
    const cat = r.catalog_item_id ? catalog.get(r.catalog_item_id) : undefined;
    const category = cat?.categoryId ? categories.get(cat.categoryId) : undefined;
    const project = r.project_id ? projects.get(r.project_id) : undefined;
    const wp = r.work_package_id ? wps.get(r.work_package_id) : undefined;
    return {
      purchasedAt: r.purchased_at,
      projectName: project?.name ?? "—",
      projectCode: project?.code ?? "",
      categoryName: category?.name ?? "",
      categoryCode: category?.code ?? "",
      // Prefer the catalog item's canonical name; fall back to the as-ordered text
      // (|| not ?? so a blank base_item also falls back).
      itemName: cat?.baseItem || r.item_description,
      itemDescription: r.item_description,
      quantity: Number(r.quantity ?? 0),
      unit: r.unit,
      amount: r.amount === null ? null : Number(r.amount),
      vatRate: Number(r.vat_rate ?? 0),
      supplierName:
        (r.supplier_id ? suppliers.get(r.supplier_id) : null) ?? r.supplier ?? "ไม่ระบุผู้ขาย",
      poNumber: (r.purchase_order_id ? pos.get(r.purchase_order_id) : null) ?? null,
      prNumber: r.pr_number,
      wpName: wp?.name ?? "",
      wpCode: wp?.code ?? "",
      neededBy: r.needed_by,
      deliveredAt: r.delivered_at,
      status: r.status,
    };
  });
}
