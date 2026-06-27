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

export async function loadPurchaseRegister(
  admin: Admin,
  from: string,
  to: string,
  projectId?: string,
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
