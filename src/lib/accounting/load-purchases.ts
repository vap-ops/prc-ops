// Spec 196 Tier 3 (U5) — loader for the accounting purchase register. Lists the
// purchase requests that POSTED to the GL in a period (purchased_at in window),
// with supplier + project resolved, so an auditor can scan what was bought and
// drill into any voucher. Reads via the admin client behind
// requireRole(ACCOUNTING_ROLES) — the register pattern; purchase_requests RLS
// otherwise excludes accounting.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

type Admin = SupabaseClient<Database>;

export interface PurchaseRegisterRow {
  id: string;
  supplierLabel: string;
  projectLabel: string;
  gross: number;
  vatRate: number;
  status: string;
  purchasedAt: string | null;
  // Spec 211 (accounting-ap-03): the PO this purchase belongs to (null = a direct/
  // site buy), so the register can group by order.
  poNumber: number | null;
}

async function poNumbers(admin: Admin, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await admin.from("purchase_orders").select("id, po_number").in("id", unique);
  for (const p of data ?? []) map.set(p.id, p.po_number);
  return map;
}

async function projectLabels(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await admin.from("projects").select("id, code, name").in("id", unique);
  for (const p of data ?? []) map.set(p.id, p.name ?? p.code);
  return map;
}

async function supplierNames(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const { data } = await admin.from("suppliers").select("id, name").in("id", unique);
  for (const s of data ?? []) map.set(s.id, s.name);
  return map;
}

// Spec 262 U2 — the report drill's dimension filter (supplier/category/
// purchaser; project reuses the existing `projectId` param). `key: ""` means
// the report's null/unassigned bucket for that dimension (e.g. "ไม่ระบุผู้ขาย"),
// mirroring the purchase_report RPC's group_key convention.
export interface RegisterDimensionFilter {
  dimension: "supplier" | "category" | "purchaser";
  key: string;
}

const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

// The report's "ไม่ระบุหมวด" bucket = a line with no catalog item, OR a
// catalog item whose category was never assigned — same null-handling as
// purchase_report's `coalesce(ci.category_id::text, '')`. categoryId=null
// resolves that bucket's item ids; a real id resolves its member items.
async function catalogItemIdsForCategory(
  admin: Admin,
  categoryId: string | null,
): Promise<string[]> {
  let q = admin.from("catalog_items").select("id");
  q = categoryId === null ? q.is("category_id", null) : q.eq("category_id", categoryId);
  const { data } = await q;
  return (data ?? []).map((r) => r.id);
}

export async function loadPurchaseRegister(
  admin: Admin,
  from: string,
  to: string,
  projectId?: string,
  slice?: RegisterDimensionFilter,
): Promise<PurchaseRegisterRow[]> {
  let q = admin
    .from("purchase_requests")
    .select(
      "id, supplier_id, supplier, amount, vat_rate, status, purchased_at, project_id, purchase_order_id",
    )
    .not("purchased_at", "is", null)
    .gte("purchased_at", from)
    // purchased_at is a timestamptz; make the upper bound inclusive of the whole
    // `to` day (a bare date compares at 00:00 and would hide same-day purchases).
    .lte("purchased_at", `${to}T23:59:59.999`)
    .order("purchased_at", { ascending: false });
  if (projectId) q = q.eq("project_id", projectId);

  if (slice?.dimension === "supplier") {
    q = slice.key === "" ? q.is("supplier_id", null) : q.eq("supplier_id", slice.key);
  } else if (slice?.dimension === "purchaser") {
    q = slice.key === "" ? q.is("requested_by", null) : q.eq("requested_by", slice.key);
  } else if (slice?.dimension === "category") {
    const categoryId = slice.key === "" ? null : slice.key;
    const ids = await catalogItemIdsForCategory(admin, categoryId);
    if (categoryId === null) {
      q =
        ids.length > 0
          ? q.or(`catalog_item_id.is.null,catalog_item_id.in.(${ids.join(",")})`)
          : q.is("catalog_item_id", null);
    } else {
      q = ids.length > 0 ? q.in("catalog_item_id", ids) : q.eq("id", NO_MATCH_ID);
    }
  }

  const { data, error } = await q;
  if (error) throw new Error(`purchase_requests: ${error.message}`);
  const rows = data ?? [];

  const [suppliers, projects, pos] = await Promise.all([
    supplierNames(
      admin,
      rows.map((r) => r.supplier_id).filter((id): id is string => id !== null),
    ),
    projectLabels(
      admin,
      rows.map((r) => r.project_id).filter((id): id is string => id !== null),
    ),
    poNumbers(
      admin,
      rows.map((r) => r.purchase_order_id).filter((id): id is string => id !== null),
    ),
  ]);

  return rows.map((r) => ({
    id: r.id,
    // Prefer the linked supplier's current name; fall back to the snapshot text
    // captured on the PR (a site purchase may name a supplier with no record).
    supplierLabel:
      (r.supplier_id ? suppliers.get(r.supplier_id) : null) ?? r.supplier ?? "ไม่ระบุผู้ขาย",
    projectLabel: (r.project_id ? projects.get(r.project_id) : null) ?? "—",
    gross: Number(r.amount ?? 0),
    vatRate: Number(r.vat_rate ?? 0),
    status: r.status,
    purchasedAt: r.purchased_at,
    poNumber: (r.purchase_order_id ? pos.get(r.purchase_order_id) : null) ?? null,
  }));
}
