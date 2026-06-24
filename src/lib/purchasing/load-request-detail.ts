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

type Tbl = Database["public"]["Tables"];
type Db = SupabaseClient<Database>;

// The fields the loader reads off the already-fetched request row.
type RequestInput = Pick<
  Tbl["purchase_requests"]["Row"],
  "id" | "work_package_id" | "requested_by" | "requested_by_email" | "purchase_order_id" | "status"
>;

export async function loadRequestDetail(
  supabase: Db,
  request: RequestInput,
  opts: { isBackOffice: boolean },
) {
  const poId = request.purchase_order_id;

  // The fan: every read depends only on the request, never on a sibling read.
  const [
    { data: wp },
    requesterNames,
    { data: attachmentRows },
    { data: poRow },
    { data: poDocRows },
    suppliers,
  ] = await Promise.all([
    // Spec 195 P1: a WP-less PR has a null work_package_id (no WP chip).
    request.work_package_id
      ? supabase
          .from("work_packages")
          .select("id, code, name, project_id")
          .eq("id", request.work_package_id)
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
  ]);

  const attachments = attachmentRows ?? [];
  const poDocs = poDocRows ?? [];

  // Dependent tail: the signed-URL mints need the rows fetched above. Links carry
  // no storage path, so only image/pdf rows are minted.
  const [attachmentUrls, poDocUrls] = await Promise.all([
    mintSignedUrlsForAttachments(
      attachments
        .filter((row) => row.kind === "image" || row.kind === "pdf")
        .map((row) => ({ id: row.id ?? "", storage_path: row.storage_path })),
    ),
    mintSignedUrls(
      PO_ATTACHMENTS_BUCKET,
      poDocs.map((row) => ({ id: row.id ?? "", storage_path: row.storage_path })),
    ),
  ]);

  const requesterName =
    (request.requested_by ? requesterNames.get(request.requested_by) : null) ??
    request.requested_by_email ??
    "—";

  return { wp, requesterName, attachments, attachmentUrls, poRow, poDocs, poDocUrls, suppliers };
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
