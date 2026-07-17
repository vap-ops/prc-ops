// Spec 324 U5 — the back-office receipt-correction queue. Every PENDING SA flag
// (a suspected over-count on a store receipt) across the viewer's projects, with
// the SA's proposed true-count, reason, and live-camera photo beside the
// receipt's ordered qty + current on-hand, and an inline approve/reject panel.
//
// Gate: BACK_OFFICE_ROLES — the same set that carries the correct_stock_receipt /
// decide_receipt_correction_request RPC gate. RLS on receipt_correction_requests
// admits back-office to every pending row (the decide RPC re-checks project
// membership, so a non-member PM's reject is refused there, not here).
//
// ⓘ Open question (U1 RLS-governed, surfaced not changed here): the is_back_office
// SELECT policy is cross-project, so a project_manager sees pending flags (+ their
// goods photos) for projects they are not a member of — visibility only, since the
// decide RPC still refuses a non-member write. Right for procurement/super/director
// (cross-project authorities); if PM should be project-scoped, that is a U1 RLS
// tightening, not a page change.

import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { ReceiptCorrectionPanel } from "@/components/features/store/receipt-correction-panel";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { PR_ATTACHMENTS_BUCKET } from "@/lib/storage/buckets";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import {
  RECEIPT_CORRECTION_QUEUE_LABEL,
  RECEIPT_CORRECTION_QUEUE_EMPTY,
  RECEIPT_CORRECTION_FLAGGED_QTY_HINT,
  RECEIPT_CORRECTION_ORDERED_HINT,
  formatThaiDateTime,
} from "@/lib/i18n/labels";

export const metadata = { title: RECEIPT_CORRECTION_QUEUE_LABEL };

export default async function ReceiptCorrectionsQueuePage() {
  const ctx = await requireRole(BACK_OFFICE_ROLES);
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("receipt_correction_requests")
    .select(
      `id, proposed_qty, reason, photo_path, requested_by, requested_at,
       stock_receipts (
         id, qty, unit, project_id, catalog_item_id,
         catalog_items ( base_item, spec_attrs ),
         projects ( code, name )
       )`,
    )
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  const reqs = (rows ?? []).filter((r) => r.stock_receipts !== null);

  // Current on-hand context (best-effort): one batched read over the involved
  // projects × items (the queue is small); missing pairs render "—".
  const projectIds = [...new Set(reqs.map((r) => r.stock_receipts!.project_id))];
  const itemIds = [...new Set(reqs.map((r) => r.stock_receipts!.catalog_item_id))];
  const onHandMap = new Map<string, number>();
  if (projectIds.length > 0 && itemIds.length > 0) {
    const { data: oh } = await supabase
      .from("stock_on_hand")
      .select("project_id, catalog_item_id, qty_on_hand")
      .in("project_id", projectIds)
      .in("catalog_item_id", itemIds);
    for (const o of oh ?? []) {
      onHandMap.set(`${o.project_id}:${o.catalog_item_id}`, Number(o.qty_on_hand));
    }
  }

  const names = await fetchDisplayNames(
    reqs.map((r) => r.requested_by),
    "[receipt-corrections]",
  );
  const photoUrls = await mintSignedUrls(
    PR_ATTACHMENTS_BUCKET,
    reqs.map((r) => ({ id: r.id, storage_path: r.photo_path })),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/projects" backLabel="กลับ">
        <h1 className="text-title text-ink font-bold tracking-tight">
          {RECEIPT_CORRECTION_QUEUE_LABEL}
        </h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        {reqs.length === 0 ? (
          <EmptyNotice>{RECEIPT_CORRECTION_QUEUE_EMPTY}</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-4">
            {reqs.map((r) => {
              const sr = r.stock_receipts!;
              const item = sr.catalog_items;
              const proj = sr.projects;
              const onHand = onHandMap.get(`${sr.project_id}:${sr.catalog_item_id}`);
              const photoUrl = photoUrls.get(r.id);
              const requester = names.get(r.requested_by);
              return (
                <li
                  key={r.id}
                  className="border-edge bg-card rounded-control flex flex-col gap-3 border px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink text-body font-semibold">
                        {item?.base_item ?? ""}
                        {item?.spec_attrs ? (
                          <span className="text-ink-secondary text-meta font-normal">
                            {" · "}
                            {item.spec_attrs}
                          </span>
                        ) : null}
                      </p>
                      {proj ? (
                        <p className="text-ink-secondary text-meta">
                          <span className="font-mono">{proj.code}</span> {proj.name}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-ink-secondary text-meta shrink-0 text-right">
                      <p>
                        {RECEIPT_CORRECTION_ORDERED_HINT} {Number(sr.qty)} {sr.unit}
                      </p>
                      <p>คงเหลือ {onHand !== undefined ? `${onHand} ${sr.unit}` : "—"}</p>
                    </div>
                  </div>

                  <div className="border-edge bg-sunk rounded-control flex flex-col gap-1 border px-3 py-2">
                    <p className="text-ink text-meta">
                      {RECEIPT_CORRECTION_FLAGGED_QTY_HINT}{" "}
                      <span className="font-semibold">
                        {Number(r.proposed_qty)} {sr.unit}
                      </span>
                    </p>
                    <p className="text-ink-secondary text-meta break-words">{r.reason}</p>
                    <p className="text-ink-muted text-meta">
                      {requester ? `${requester} · ` : ""}
                      {formatThaiDateTime(r.requested_at)}
                    </p>
                  </div>

                  {photoUrl ? (
                    <span className="border-edge block h-24 w-24 overflow-hidden rounded-lg border">
                      <ZoomablePhoto src={photoUrl} />
                    </span>
                  ) : null}

                  <ReceiptCorrectionPanel
                    mode="decide"
                    requestId={r.id}
                    proposedQty={Number(r.proposed_qty)}
                    orderedQty={Number(sr.qty)}
                    unit={sr.unit}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
