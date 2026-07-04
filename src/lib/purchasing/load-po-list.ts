// Spec 262 U3 — the PO list loader. Reads via the admin client behind the
// page's PO_DETAIL_VIEW_ROLES gate (site_admin already sees PO money on the
// detail page under this same gate, so the list is consistent). Supplier
// filter + period (ordered_at) are pushed to the DB query; project narrowing
// happens in the pure layer (a PO carries no project column — only its
// member lines do, per ADR 0044).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { bangkokTodayIso } from "@/lib/dates";
import { derivePurchaseOrderStatus } from "@/lib/purchasing/purchase-order";
import {
  buildPoListRow,
  poAgingDays,
  type PoListAggregateLine,
  type PoListRow,
} from "@/lib/purchasing/po-list-view";

type Admin = SupabaseClient<Database>;
type PoChargeType = Database["public"]["Enums"]["po_charge_type"];

export interface PoListLoadFilters {
  supplierId?: string;
  from?: string;
  to?: string;
}

export async function loadPurchaseOrderList(
  admin: Admin,
  filters: PoListLoadFilters,
): Promise<PoListRow[]> {
  let poQuery = admin
    .from("purchase_orders")
    .select("id, po_number, supplier, supplier_id, ordered_at")
    .order("ordered_at", { ascending: false, nullsFirst: false });
  if (filters.supplierId) poQuery = poQuery.eq("supplier_id", filters.supplierId);
  if (filters.from) poQuery = poQuery.gte("ordered_at", filters.from);
  if (filters.to) poQuery = poQuery.lte("ordered_at", `${filters.to}T23:59:59.999`);

  const { data: poRows, error } = await poQuery;
  if (error) throw new Error(`purchase_orders: ${error.message}`);
  const pos = poRows ?? [];
  if (pos.length === 0) return [];

  const poIds = pos.map((p) => p.id);
  const [{ data: lineRows }, { data: chargeRows }, { data: supplierRows }] = await Promise.all([
    admin
      .from("purchase_requests")
      .select("purchase_order_id, status, amount, project_id")
      .in("purchase_order_id", poIds),
    admin
      .from("purchase_order_charges")
      .select("purchase_order_id, charge_type, amount")
      .in("purchase_order_id", poIds),
    admin
      .from("suppliers")
      .select("id, name")
      .in("id", [...new Set(pos.map((p) => p.supplier_id))]),
  ]);

  const linesByPo = new Map<string, PoListAggregateLine[]>();
  for (const l of lineRows ?? []) {
    if (!l.purchase_order_id) continue;
    const arr = linesByPo.get(l.purchase_order_id) ?? [];
    arr.push({ status: l.status, amount: l.amount, projectId: l.project_id });
    linesByPo.set(l.purchase_order_id, arr);
  }
  const chargesByPo = new Map<string, { charge_type: PoChargeType; amount: number }[]>();
  for (const c of chargeRows ?? []) {
    const arr = chargesByPo.get(c.purchase_order_id) ?? [];
    arr.push({ charge_type: c.charge_type, amount: c.amount });
    chargesByPo.set(c.purchase_order_id, arr);
  }
  const supplierNameById = new Map((supplierRows ?? []).map((s) => [s.id, s.name]));

  const projectIds = [...new Set((lineRows ?? []).map((l) => l.project_id))];
  const { data: projectRows } = await admin
    .from("projects")
    .select("id, code, name")
    .in("id", projectIds);
  const projectNameById = new Map((projectRows ?? []).map((p) => [p.id, p.name ?? p.code]));

  const today = bangkokTodayIso();
  return pos.map((po) =>
    buildPoListRow(
      {
        id: po.id,
        poNumber: po.po_number,
        supplierId: po.supplier_id,
        supplierLabel: supplierNameById.get(po.supplier_id) ?? po.supplier ?? "ไม่ระบุผู้ขาย",
        orderedAt: po.ordered_at,
        lines: linesByPo.get(po.id) ?? [],
        charges: chargesByPo.get(po.id) ?? [],
      },
      projectNameById,
      today,
    ),
  );
}

// Spec 262 U4 — the /requests home tile's data: every PO's aging (null once
// received), with NO supplier/project/charge resolution (the tile only needs
// a count + worst-case wait) — deliberately lighter than loadPurchaseOrderList
// above, since this runs on the high-traffic worklist home rather than the
// dedicated list page.
export async function loadPendingPoAging(admin: Admin): Promise<Array<number | null>> {
  const { data: poRows } = await admin.from("purchase_orders").select("id, ordered_at");
  const pos = poRows ?? [];
  if (pos.length === 0) return [];

  const poIds = pos.map((p) => p.id);
  const { data: lineRows } = await admin
    .from("purchase_requests")
    .select("purchase_order_id, status")
    .in("purchase_order_id", poIds);

  const statusesByPo = new Map<string, Database["public"]["Enums"]["purchase_request_status"][]>();
  for (const l of lineRows ?? []) {
    if (!l.purchase_order_id) continue;
    const arr = statusesByPo.get(l.purchase_order_id) ?? [];
    arr.push(l.status);
    statusesByPo.set(l.purchase_order_id, arr);
  }

  const today = bangkokTodayIso();
  return pos.map((po) => {
    const status = derivePurchaseOrderStatus(statusesByPo.get(po.id) ?? []);
    return poAgingDays(po.ordered_at, status, today);
  });
}
