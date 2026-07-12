// Spec 147 U3 — request-detail data loader. The page formerly ran its reads in a
// serial waterfall (request → wp → requester name → attachments → signed URLs →
// poRow → po-docs → signed URLs → suppliers). Every child read depends only on
// the request, so they batch into one Promise.all (root already fetched by the
// page) → dependent tail (the signed-URL mints need their attachment rows).
// Behavior-preserving: same queries, same column lists, same results — only the
// scheduling changes. Mirrors loadWorkPackageDetail (U1) / loadProjectDetail (U2).
// Concurrency is locked by tests/unit/load-request-detail.test.ts.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { mintSignedUrlsForAttachments } from "@/lib/purchasing/attachment-signed-urls";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PO_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { loadWpCategoryScope } from "@/lib/catalog/wp-category-scope";
import { membershipsByItem } from "@/lib/catalog/categories";
import { prCategoryMatch, type PrCategoryMatch } from "@/lib/purchasing/pr-category-match";

type Tbl = Database["public"]["Tables"];
type Db = SupabaseClient<Database>;

// The fields the loader reads off the already-fetched request row.
type RequestInput = Pick<
  Tbl["purchase_requests"]["Row"],
  | "id"
  | "work_package_id"
  | "requested_from_work_package_id"
  | "requested_by"
  | "requested_by_email"
  | "purchase_order_id"
  | "status"
  | "catalog_item_id"
>;

export async function loadRequestDetail(
  supabase: Db,
  request: RequestInput,
  opts: { isBackOffice: boolean },
) {
  const poId = request.purchase_order_id;
  // Spec 301 U2a: display/flag anchor — the binding WP (legacy rows) or the
  // provenance WP (modern store-bound rows, ADR 0065 keeps work_package_id null).
  const anchorWpId = request.work_package_id ?? request.requested_from_work_package_id;

  // The fan: every read depends only on the request, never on a sibling read.
  const [
    { data: wp },
    requesterNames,
    { data: attachmentRows },
    { data: poRow },
    { data: poDocRows },
    suppliers,
    { data: catalogItem },
    { data: itemMembershipRows },
  ] = await Promise.all([
    // Spec 195 P1: a fully WP-less PR has no anchor (no WP chip).
    // Spec 301 U1/U2a: + category_id for the letter-code reconcile below;
    // anchored on binding-or-provenance.
    anchorWpId
      ? supabase
          .from("work_packages")
          .select("id, code, name, project_id, category_id")
          .eq("id", anchorWpId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    fetchDisplayNames(request.requested_by ? [request.requested_by] : [], "[requests/detail]"),
    supabase
      .from("purchase_request_attachments_current")
      .select("id, purchase_request_id, kind, purpose, storage_path, url, created_by, created_at")
      .eq("purchase_request_id", request.id)
      .order("created_at", { ascending: true }),
    poId
      ? supabase.from("purchase_orders").select("po_number").eq("id", poId).maybeSingle()
      : Promise.resolve({ data: null }),
    poId
      ? supabase
          .from("purchase_order_attachments_current")
          .select("id, kind, storage_path, created_at")
          // Spec 134 U4a: source docs only — proof-of-delivery is its own purpose.
          .eq("purchase_order_id", poId)
          .eq("purpose", "source_document")
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),
    loadSuppliers(supabase, opts.isBackOffice, request.status),
    // Spec 301 U2: the off-category verdict needs the PR item's canonical
    // category + its secondary memberships (both authenticated-readable).
    request.catalog_item_id
      ? supabase
          .from("catalog_items")
          .select("id, category_id")
          .eq("id", request.catalog_item_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    request.catalog_item_id
      ? supabase
          .from("catalog_item_categories")
          .select("catalog_item_id, category_id")
          .eq("catalog_item_id", request.catalog_item_id)
      : Promise.resolve({ data: null }),
  ]);

  const attachments = attachmentRows ?? [];
  const poDocs = poDocRows ?? [];

  // Dependent tail: the signed-URL mints need the rows fetched above. Links carry
  // no storage path, so only image/pdf rows are minted. Spec 301 U1/U2: the WP's
  // whole category chain (letter-code + Relation-R scope) rides the same tail —
  // via the ADMIN client, because project_categories RLS is membership-gated and
  // denies procurement (this page's reviewer). The resolved W0x code and scope
  // are non-sensitive display metadata (same posture as display names).
  const [attachmentUrls, poDocUrls, categoryScope] = await Promise.all([
    mintSignedUrlsForAttachments(
      attachments
        .filter((row) => row.kind === "image" || row.kind === "pdf")
        .map((row) => ({ id: row.id ?? "", storage_path: row.storage_path })),
    ),
    mintSignedUrls(
      PO_ATTACHMENTS_BUCKET,
      poDocs.map((row) => ({ id: row.id ?? "", storage_path: row.storage_path })),
    ),
    loadWpCategoryScope(createAdminSupabase(), wp?.category_id ?? null),
  ]);

  const requesterName =
    (request.requested_by ? requesterNames.get(request.requested_by) : null) ??
    request.requested_by_email ??
    "—";

  const wpCategoryCode = categoryScope.workCategoryCode;

  // Spec 301 U2 — the approver-side off-category verdict, picker semantics
  // (category-only, canonical∪secondary vs the deduped Relation-R categories;
  // no verdict for a free-text PR or when no scope is active).
  const scopedCategoryIds = [...new Set(categoryScope.scopedRelation.map((r) => r.categoryId))];
  const categoryMatch: PrCategoryMatch = prCategoryMatch(
    catalogItem ? { id: catalogItem.id, categoryId: catalogItem.category_id } : null,
    membershipsByItem(
      (itemMembershipRows ?? []).map((r) => ({
        catalogItemId: r.catalog_item_id,
        categoryId: r.category_id,
      })),
    ),
    scopedCategoryIds,
  );

  return {
    wp,
    wpCategoryCode,
    categoryMatch,
    requesterName,
    attachments,
    attachmentUrls,
    poRow,
    poDocs,
    poDocUrls,
    suppliers,
  };
}

// Spec 33 / ADR 0038: suppliers feed the record-purchase form, shown only when
// back office can act on an approved request.
async function loadSuppliers(
  supabase: Db,
  isBackOffice: boolean,
  status: RequestInput["status"],
): Promise<Pick<Tbl["suppliers"]["Row"], "id" | "name" | "phone">[]> {
  if (!(isBackOffice && status === "approved")) return [];
  const { data } = await supabase
    .from("suppliers")
    .select("id, name, phone")
    .order("name", { ascending: true });
  return data ?? [];
}
