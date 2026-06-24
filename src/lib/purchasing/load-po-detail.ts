// Spec 148 U1 — PO-detail data loader. The page ran po → members → deliveries →
// wp-by-id → amounts in series; po/members/deliveries are all poId-keyed and the
// last two depend only on the members. Collapsed to one Promise.all fan (po ∥
// members ∥ deliveries) → dependent tail (wp-by-id ∥ per-line amounts, both need
// the members). Behavior-preserving. Mirrors the spec-147 loaders.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { PR_LIST_COLUMNS } from "@/lib/purchasing/columns";

type Tbl = Database["public"]["Tables"];
type Db = SupabaseClient<Database>;
type WpChip = Pick<Tbl["work_packages"]["Row"], "id" | "code" | "name" | "project_id">;

export async function loadPurchaseOrderDetail(
  supabase: Db,
  poId: string,
  opts: { isBackOffice: boolean },
) {
  // The fan: po, member tickets, and deliveries are all poId-keyed, independent.
  const [{ data: po }, { data: memberRows }, { data: deliveryRows }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, po_number, supplier, supplier_id, eta, ordered_at, notes")
      .eq("id", poId)
      .maybeSingle(),
    supabase
      .from("purchase_requests")
      .select(`${PR_LIST_COLUMNS}, delivery_id`)
      .eq("purchase_order_id", poId)
      .order("pr_number", { ascending: true }),
    supabase
      .from("purchase_order_deliveries")
      .select("id, eta, created_at")
      .eq("purchase_order_id", poId)
      .order("created_at", { ascending: true }),
  ]);

  const members = memberRows ?? [];
  // Spec 195 P1: a PR's work package is optional — drop null ids before the lookup.
  const wpIds = Array.from(
    new Set(members.map((m) => m.work_package_id).filter((id): id is string => id !== null)),
  );
  const memberIds = members.map((m) => m.id);

  // Dependent tail: both need the member rows. WP chips (RLS client) and per-line
  // amounts (admin client, back-office money — spec 106) run together.
  const [wpRes, amountById] = await Promise.all([
    wpIds.length
      ? supabase.from("work_packages").select("id, code, name, project_id").in("id", wpIds)
      : Promise.resolve({ data: [] as WpChip[] }),
    loadAmounts(opts.isBackOffice, memberIds),
  ]);

  const wpById = new Map((wpRes.data ?? []).map((wp) => [wp.id, wp]));
  return { po, members, deliveryRows: deliveryRows ?? [], wpById, amountById };
}

// Spec 106 / ADR 0038: per-line amount via the admin client, gated to back office.
async function loadAmounts(
  isBackOffice: boolean,
  ids: string[],
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  if (!isBackOffice || ids.length === 0) return map;
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_requests").select("id, amount").in("id", ids);
  for (const a of data ?? []) map.set(a.id, a.amount);
  return map;
}
