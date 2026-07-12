import "server-only";

// Perf (RUM-aimed TTFB, 2026-07-10). The /requests procurement variant used to run
// ~15 sequential DB round-trips because each enrichment read was awaited on its own
// line even though they are mutually independent (they depend only on the already-
// loaded request rows). This loader is the page's data layer, restructured so those
// independent reads fire in ONE Promise.all wave. Only two dependency chains stay
// serial: itemLinks → catalog_items (a PR's category needs its item link first), and
// the PO facts pair. Every read/filter/client is identical to the former inline code,
// so the assembled maps are byte-for-byte the same (pinned by load-requests-data.test).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { PurchaseRequestStatus } from "@/lib/db/enums";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { loadCategoryVendors } from "@/lib/purchasing/load-category-vendors";
import { loadCatalogCategories, categoryNameById } from "@/lib/catalog/categories";
import { loadCategoryCodeById } from "@/lib/work-categories/load-category-codes";
import { procurementBand, sumOutstanding } from "@/lib/purchasing/procurement-pipeline";
import { buildPoDetailView } from "@/lib/purchasing/po-detail";
import type { PurchaseOrderStatus } from "@/lib/purchasing/purchase-order";
import type { SupplierOption } from "@/lib/purchasing/supplier-option";

type Db = SupabaseClient<Database>;

// The fields of a request row this loader reads. The page's `myRequests` rows carry
// more columns; only these drive the enrichment reads.
export interface RequestRowForData {
  id: string;
  requested_by: string | null;
  work_package_id: string | null;
  project_id: string | null;
  purchase_order_id: string | null;
  status: PurchaseRequestStatus;
}

export type WpLabel = {
  id: string;
  code: string;
  name: string;
  project_id: string | null;
  /** Spec 301 U1: reconciled global work-category code (W0x) for the spec-277
   *  letter-code render; null for an uncategorised/unreconciled WP. */
  categoryCode: string | null;
};

export interface PoFacts {
  poNumber: number;
  supplier: string;
  eta: string | null;
  status: PurchaseOrderStatus;
  lineCount: number;
}

export interface RequestsData {
  requesterNames: Map<string, string>;
  wpById: Map<string, WpLabel>;
  projectNameById: Map<string, string>;
  amountById: Map<string, number | null>;
  outstanding: number;
  deliveredSpend: number;
  prCategory: Map<string, { id: string | null; name: string | null }>;
  poFactsById: Map<string, PoFacts>;
  poNumberById: Map<string, number>;
  supplierRecords: SupplierOption[];
  categoryVendors: Record<string, string[]>;
  docCountById: Map<string, number>;
}

export interface LoadRequestsDataArgs {
  /** User-session client (RLS-respecting). */
  supabase: Db;
  /** The merged pending + decided request rows already loaded by the page. */
  myRequests: ReadonlyArray<RequestRowForData>;
  isProcurement: boolean;
  /** PO ids of the in-transit PO groups (derived in the page from procurementGroups). */
  inTransitPoIds: ReadonlyArray<string>;
}

/**
 * Load and assemble every enrichment map the /requests page renders from, firing the
 * independent reads concurrently. Output is identical to the former inline logic.
 */
export async function loadRequestsData(args: LoadRequestsDataArgs): Promise<RequestsData> {
  const { supabase, myRequests, isProcurement, inTransitPoIds } = args;
  const prIds = myRequests.map((r) => r.id);

  // #5 Requester display names (site-wide, ADR 0026) — always-on, admin-client via helper.
  async function loadRequesterNames(): Promise<Map<string, string>> {
    const ids = Array.from(
      new Set(
        myRequests.map((r) => r.requested_by).filter((id): id is string => typeof id === "string"),
      ),
    );
    return fetchDisplayNames(ids, "[requests]");
  }

  // #6 WP code/name/project for the list rows — always-on. Spec 301 U1: also
  // carries category_id → the reconciled work-category code (a genuine serial
  // tail inside this thunk: the reconcile needs the fetched category_ids). The
  // reconcile reads project_categories via the ADMIN client: its RLS is
  // membership-gated (can_see_project → false for procurement roles), yet
  // procurement is this page's audience. The resolved W0x code is non-sensitive
  // display metadata — same enrichment posture as display names (ADR 0026).
  async function loadWpById(): Promise<Map<string, WpLabel>> {
    const wpIds = Array.from(
      new Set(myRequests.map((r) => r.work_package_id).filter((id): id is string => id !== null)),
    );
    const { data } = await supabase
      .from("work_packages")
      .select("id, code, name, project_id, category_id")
      .in("id", wpIds);
    const wps = data ?? [];
    const codeById = await loadCategoryCodeById(
      createAdminSupabase(),
      wps.map((wp) => wp.category_id).filter((id): id is string => id !== null),
    );
    return new Map(
      wps.map((wp) => [
        wp.id,
        {
          id: wp.id,
          code: wp.code,
          name: wp.name,
          project_id: wp.project_id,
          categoryCode: wp.category_id ? (codeById.get(wp.category_id) ?? null) : null,
        },
      ]),
    );
  }

  // #7 Project names for the procurement project filter — procurement only (spec 110).
  async function loadProjectNames(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!isProcurement) return out;
    const projectIds = Array.from(
      new Set(myRequests.map((r) => r.project_id).filter((id): id is string => id !== null)),
    );
    if (projectIds.length === 0) return out;
    const { data } = await supabase.from("projects").select("id, name").in("id", projectIds);
    for (const p of data ?? []) out.set(p.id, p.name);
    return out;
  }

  // #8 Amounts (money → admin read), outstanding, delivered spend — procurement only.
  async function loadAmounts(): Promise<{
    amountById: Map<string, number | null>;
    outstanding: number;
    deliveredSpend: number;
  }> {
    const amountById = new Map<string, number | null>();
    let outstanding = 0;
    let deliveredSpend = 0;
    if (isProcurement && myRequests.length > 0) {
      const admin = createAdminSupabase();
      const { data: amountRows } = await admin
        .from("purchase_requests")
        .select("id, amount")
        .in("id", prIds);
      for (const a of amountRows ?? []) amountById.set(a.id, a.amount);
      outstanding = sumOutstanding(
        myRequests
          .filter((r) => procurementBand(r.status) === "in_transit")
          .map((r) => ({ amount: amountById.get(r.id) ?? null })),
      );
    }
    if (isProcurement) {
      for (const r of myRequests) {
        if (r.status === "delivered") deliveredSpend += amountById.get(r.id) ?? 0;
      }
    }
    return { amountById, outstanding, deliveredSpend };
  }

  // #9 Each PR's managed material category (spec 230) — procurement only. itemLinks →
  // catalog_items is a genuine serial dependency; catalog categories runs beside it.
  async function loadPrCategory(): Promise<
    Map<string, { id: string | null; name: string | null }>
  > {
    const prCategory = new Map<string, { id: string | null; name: string | null }>();
    if (!isProcurement || myRequests.length === 0) return prCategory;
    const { data: itemLinks } = await supabase
      .from("purchase_requests")
      .select("id, catalog_item_id")
      .in("id", prIds);
    const itemIds = [
      ...new Set(
        (itemLinks ?? []).map((l) => l.catalog_item_id).filter((x): x is string => x != null),
      ),
    ];
    const [itemRowsRes, cats] = await Promise.all([
      itemIds.length > 0
        ? supabase.from("catalog_items").select("id, category_id").in("id", itemIds)
        : Promise.resolve({ data: [] as { id: string; category_id: string | null }[] }),
      loadCatalogCategories(supabase),
    ]);
    const itemCategory = new Map<string, string | null>();
    for (const it of itemRowsRes.data ?? []) itemCategory.set(it.id, it.category_id);
    const nameById = categoryNameById(cats);
    for (const l of itemLinks ?? []) {
      const catId = l.catalog_item_id ? (itemCategory.get(l.catalog_item_id) ?? null) : null;
      const name = catId ? (nameById.get(catId) ?? null) : null;
      // Keep id + name consistent: a category with no resolvable name is uncategorised.
      prCategory.set(l.id, { id: name ? catId : null, name });
    }
    return prCategory;
  }

  // #10 PO facts for the in-transit PO groups (spec 134 U2) — procurement only.
  async function loadPoFacts(): Promise<Map<string, PoFacts>> {
    const poFactsById = new Map<string, PoFacts>();
    if (!isProcurement || inTransitPoIds.length === 0) return poFactsById;
    const poIds = [...inTransitPoIds];
    const [poRes, memberRes] = await Promise.all([
      supabase.from("purchase_orders").select("id, po_number, supplier, eta").in("id", poIds),
      supabase
        .from("purchase_requests")
        .select("id, status, purchase_order_id")
        .in("purchase_order_id", poIds),
    ]);
    const memberStatusesByPo = new Map<string, PurchaseRequestStatus[]>();
    for (const m of memberRes.data ?? []) {
      if (!m.purchase_order_id) continue;
      const arr = memberStatusesByPo.get(m.purchase_order_id) ?? [];
      arr.push(m.status);
      memberStatusesByPo.set(m.purchase_order_id, arr);
    }
    for (const po of poRes.data ?? []) {
      const view = buildPoDetailView(
        (memberStatusesByPo.get(po.id) ?? []).map((status) => ({ status, amount: null })),
      );
      poFactsById.set(po.id, {
        poNumber: po.po_number,
        supplier: po.supplier,
        eta: po.eta,
        status: view.status,
        lineCount: view.activeLineCount,
      });
    }
    return poFactsById;
  }

  // #11 The human PO number for every PO any row belongs to (spec 211 U5) — procurement only.
  async function loadPoNumbers(): Promise<Map<string, number>> {
    const poNumberById = new Map<string, number>();
    if (!isProcurement) return poNumberById;
    const allPoIds = [
      ...new Set(
        myRequests.map((r) => r.purchase_order_id).filter((id): id is string => id != null),
      ),
    ];
    if (allPoIds.length === 0) return poNumberById;
    const { data } = await supabase
      .from("purchase_orders")
      .select("id, po_number")
      .in("id", allPoIds);
    for (const po of data ?? []) poNumberById.set(po.id, po.po_number);
    return poNumberById;
  }

  // #12 Suppliers picker + category vendors + per-PR document counts (spec 114/280) —
  // procurement only; the three are mutually independent.
  async function loadProcurementExtras(): Promise<{
    supplierRecords: SupplierOption[];
    categoryVendors: Record<string, string[]>;
    docCountById: Map<string, number>;
  }> {
    const docCountById = new Map<string, number>();
    if (!isProcurement) {
      return { supplierRecords: [], categoryVendors: {}, docCountById };
    }
    const [supplierRes, categoryVendors, attachRes] = await Promise.all([
      supabase
        .from("suppliers")
        .select("id, name, phone, is_vat_registered")
        .neq("contact_status", "blacklisted")
        .order("name", { ascending: true }),
      loadCategoryVendors(supabase),
      myRequests.length > 0
        ? supabase
            .from("purchase_request_attachments_current")
            .select("purchase_request_id")
            .in("purchase_request_id", prIds)
        : Promise.resolve({ data: [] as { purchase_request_id: string | null }[] }),
    ]);
    const supplierRecords: SupplierOption[] = (supplierRes.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      isVatRegistered: r.is_vat_registered,
    }));
    for (const a of attachRes.data ?? []) {
      if (a.purchase_request_id) {
        docCountById.set(a.purchase_request_id, (docCountById.get(a.purchase_request_id) ?? 0) + 1);
      }
    }
    return { supplierRecords, categoryVendors, docCountById };
  }

  const [
    requesterNames,
    wpById,
    projectNameById,
    amounts,
    prCategory,
    poFactsById,
    poNumberById,
    extras,
  ] = await Promise.all([
    loadRequesterNames(),
    loadWpById(),
    loadProjectNames(),
    loadAmounts(),
    loadPrCategory(),
    loadPoFacts(),
    loadPoNumbers(),
    loadProcurementExtras(),
  ]);

  return {
    requesterNames,
    wpById,
    projectNameById,
    amountById: amounts.amountById,
    outstanding: amounts.outstanding,
    deliveredSpend: amounts.deliveredSpend,
    prCategory,
    poFactsById,
    poNumberById,
    supplierRecords: extras.supplierRecords,
    categoryVendors: extras.categoryVendors,
    docCountById: extras.docCountById,
  };
}
