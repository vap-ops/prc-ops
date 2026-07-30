// Spec 380 U3 — the ONE read path for doc-chase state (page + dashboard chip).
// IO only; every derivation lives in the pure assemble/build fns (tested).
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { IN_SCOPE_STATUSES } from "@/lib/purchasing/doc-chase";
import { assembleDocChaseOrders, type DocChaseOrderInput } from "@/lib/purchasing/doc-chase-view";

export interface DocChaseLoad {
  orders: DocChaseOrderInput[];
  /** The read instant — aging math anchors here, not in render (purity rule). */
  nowMs: number;
}

export async function loadDocChaseOrders(
  supabase: SupabaseClient<Database>,
): Promise<DocChaseLoad> {
  const [prs, prAtts, poAtts, waivers, sups] = await Promise.all([
    supabase
      .from("purchase_requests")
      .select(
        "id, pr_number, item_description, status, project_id, supplier_id, supplier, purchase_order_id, delivered_at, purchased_at, created_at",
      )
      .in("status", [...IN_SCOPE_STATUSES]),
    // The _current views ARE the current-state read (superseded_by null AND
    // not pointed-at) — never the base tables, never a hand-rolled filter.
    supabase
      .from("purchase_request_attachments_current")
      .select("purchase_request_id, doc_type, purpose"),
    supabase
      .from("purchase_order_attachments_current")
      .select("purchase_order_id, doc_type, purpose"),
    supabase.from("purchase_doc_waivers").select("purchase_request_id"),
    supabase.from("suppliers").select("id, name, is_vat_registered"),
  ]);

  const nowMs = Date.now();
  const orders = assembleDocChaseOrders({
    prs: prs.data ?? [],
    // View columns are all-nullable in the generated types; a row without its
    // parent key or purpose is unusable — drop it rather than fabricate one.
    prAttachments: (prAtts.data ?? []).flatMap((a) =>
      a.purchase_request_id !== null && a.purpose !== null
        ? [{ purchase_request_id: a.purchase_request_id, doc_type: a.doc_type, purpose: a.purpose }]
        : [],
    ),
    poAttachments: (poAtts.data ?? []).flatMap((a) =>
      a.purchase_order_id !== null && a.purpose !== null
        ? [{ purchase_order_id: a.purchase_order_id, doc_type: a.doc_type, purpose: a.purpose }]
        : [],
    ),
    waivedPrIds: new Set((waivers.data ?? []).map((w) => w.purchase_request_id)),
    suppliers: new Map(
      (sups.data ?? []).map((s) => [s.id, { name: s.name, isVatRegistered: s.is_vat_registered }]),
    ),
  });
  return { orders, nowMs };
}
