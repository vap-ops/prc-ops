// Spec 148 U2 — delivery-detail data loader. The page ran po → delivery →
// members → deliveryRows → proofRows → proof signed URLs in series; the first
// five are all poId/deliveryId-keyed and independent. Collapsed to one
// Promise.all fan (5) → dependent tail (the งวด view + grouped proof + signed
// URLs derive from those rows). Behavior-preserving. Mirrors the spec-147 loaders.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { PR_LIST_COLUMNS } from "@/lib/purchasing/columns";
import {
  buildDeliveriesView,
  groupProofByDelivery,
  type ProofDeliveryDoc,
} from "@/lib/purchasing/po-deliveries";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PO_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";

type Db = SupabaseClient<Database>;

export async function loadDeliveryDetail(supabase: Db, poId: string, deliveryId: string) {
  // The fan: po, this delivery, the PO's member tickets, all its deliveries, and
  // its proof attachments — all poId/deliveryId-keyed, independent.
  const [{ data: po }, { data: delivery }, { data: memberRows }, { data: deliveryRows }, { data: proofRows }] =
    await Promise.all([
      supabase.from("purchase_orders").select("id, po_number, supplier").eq("id", poId).maybeSingle(),
      supabase
        .from("purchase_order_deliveries")
        .select("id, eta, note, cost, created_at")
        .eq("id", deliveryId)
        .eq("purchase_order_id", poId)
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
      supabase
        .from("purchase_order_attachments_current")
        .select("id, kind, storage_path, delivery_id")
        .eq("purchase_order_id", poId)
        .eq("purpose", "proof_of_delivery")
        .order("created_at", { ascending: true }),
    ]);

  const members = memberRows ?? [];

  // Derive the งวด view (ordinal/status), then this delivery's proof bucket
  // (legacy NULL proof falls under the default = earliest delivery).
  const deliveries = buildDeliveriesView(
    deliveryRows ?? [],
    members.map((m) => ({
      delivery_id: m.delivery_id,
      status: m.status,
      delivered_at: m.delivered_at,
    })),
  );
  const proofByDelivery = groupProofByDelivery<ProofDeliveryDoc>(
    (proofRows ?? []).map((d) => ({
      id: d.id,
      kind: d.kind,
      storage_path: d.storage_path,
      delivery_id: d.delivery_id,
    })),
    deliveries[0]?.id ?? null,
  );
  const proofDocs = proofByDelivery.get(deliveryId) ?? [];

  // Dependent tail: signed URLs for this delivery's proof rows.
  const proofUrls = await mintSignedUrls(
    PO_ATTACHMENTS_BUCKET,
    proofDocs.map((row) => ({ id: row.id ?? "", storage_path: row.storage_path })),
  );

  return { po, delivery, members, deliveries, proofDocs, proofUrls };
}
