import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/features/app-header";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { roleHome } from "@/lib/auth/role-home";
import {
  PurchaseRequestForm,
  type PurchaseRequestFormWorkPackage,
} from "@/components/features/purchase-request-form";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { isValidUuid } from "@/lib/photos/path";
import type { Database } from "@/lib/db/database.types";

// /requests — THE purchasing surface for every role (spec 19 §4 merged
// the PM decision queue here; spec 16 A1 / ADR 0026 made the list
// site-wide). The request form appears when arriving FROM a work package
// (spec 10: ?wp=<id> pins the WP; there is no picker — WP screens carry
// the "Raise purchase request" link). Authorized: site_admin,
// project_manager, super_admin — the v1 requester base (ADR 0022).
//
// Server-side fetches:
//   1. the ?wp= work package (only when the param has UUID shape) — RLS on
//      work_packages already gates readability to wp-readers; an
//      unreadable or unknown id resolves to null and the form is withheld.
//   2. ALL visible purchase_requests — RLS decides (site_admin/PM/
//      procurement/super see every row since ADR 0026; the own-row
//      branch remains for future narrower roles). The ?mine=1 chip
//      narrows back to the caller's own rows.

import {
  PURCHASE_REQUEST_PRIORITY_LABEL,
  PURCHASE_REQUEST_STATUS_LABEL,
  formatThaiDate,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import {
  purchaseRequestPriorityPillClasses,
  purchaseRequestStatusPillClasses,
  type PurchaseRequestPriority,
} from "@/lib/status-colors";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { PurchaseRequestDecision } from "@/components/features/purchase-request-decision";
import { PurchaseRequestCancel } from "@/components/features/purchase-request-cancel";
import {
  PurchaseRecordForm,
  type SupplierOption,
} from "@/components/features/purchase-record-form";
import { PurchaseRequestShip } from "@/components/features/purchase-request-ship";
import { isBackOfficeRole } from "@/lib/purchasing/back-office";
import { PurchaseRequestTracker } from "@/components/features/purchase-request-tracker";
import { DeliveryPhotoUploader } from "@/components/features/delivery-photo-uploader";
import { PurchaseRequestAttachmentStager } from "@/components/features/purchase-request-attachment-stager";
import { AttachmentRemoveButton } from "@/components/features/attachment-remove-button";
import { ZoomablePhoto } from "@/components/features/photo-lightbox";
import { mintSignedUrlsForAttachments } from "@/lib/purchasing/attachment-signed-urls";
import { fetchDisplayNames } from "@/lib/users/display-names";

type PurchaseRequestStatus = Database["public"]["Enums"]["purchase_request_status"];

// Spec 19 §4: the single purchasing surface for every role. PM/super
// see the decision controls inline on requested rows (the old
// /pm/requests queue, merged here); the list is pending-first
// (priority band then requested asc — spec-16 A2), decided rows below
// newest-first. The whole list is site-wide for every role since
// spec-16 addendum A1 / ADR 0026 widened the SELECT policy.
export const metadata = { title: "คำขอซื้อ" };

interface RequestsPageProps {
  searchParams: Promise<{ wp?: string | string[]; mine?: string | string[] }>;
}

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
  const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { wp: wpParam, mine: mineParam } = await searchParams;
  const wpRequested = wpParam !== undefined;

  // Resolve the pinned WP only for a well-formed single UUID; anything
  // else (missing, repeated, garbage, or unreadable under RLS) leaves the
  // form withheld. maybeSingle() returns null rather than erroring when
  // RLS filters the row out, so "not found" and "not allowed" look the
  // same here — intentionally.
  let pinnedWp: PurchaseRequestFormWorkPackage | null = null;
  let pinnedProjectId: string | null = null;
  if (typeof wpParam === "string" && isValidUuid(wpParam)) {
    const { data } = await supabase
      .from("work_packages")
      .select("id, code, name, project_id")
      .eq("id", wpParam)
      .maybeSingle();
    if (data) {
      pinnedWp = { id: data.id, code: data.code, name: data.name };
      pinnedProjectId = data.project_id;
    }
  }

  // Back affordance (spec 12): pinned → the WP screen the user came from
  // (the SA WP route admits sa/pm/super, so it is valid for every role
  // that can reach this form); bare → the caller's role home.
  const backHref =
    pinnedWp && pinnedProjectId
      ? `/sa/projects/${pinnedProjectId}/work-packages/${pinnedWp.id}`
      : roleHome(ctx.role);
  const backLabel = pinnedWp && pinnedProjectId ? "กลับไปหน้ารายการงาน" : "กลับ";

  // The SELECT policy (ADR 0022, widened by ADR 0026) admits the whole
  // row, so the decision + back-office fact columns are readable here.
  // The PM's rejection comment is mandatory at the DB layer
  // (pr_reject_has_comment); purchased_at / supplier / delivered_at /
  // received_by / delivery_note are written by procurement in AppSheet
  // (ADR 0025) and are null until that stage.
  // RLS decides visibility (site-wide for sa/pm/procurement/super since
  // ADR 0026; the own-row branch remains for future narrower roles) —
  // no .eq(requested_by) filter since the spec-19 merge: PMs decide
  // here now.
  const { data: visibleRequests, error: myError } = await supabase
    .from("purchase_requests")
    .select(
      "id, pr_number, work_package_id, item_description, quantity, unit, status, requested_at, requested_by, requested_by_email, decision_comment, decided_at, purchased_at, shipped_at, supplier, delivered_at, received_by, delivery_note, needed_by, eta, priority",
    )
    .order("requested_at", { ascending: false });

  // ของฉัน filter chip (spec 16 A1): ?mine=1 narrows to the caller's own
  // rows. Server-side via searchParams — same zero-client-JS pattern as
  // the rest of the page (deviation from A1's "client-side" wording,
  // recorded in the tracker).
  const mineOnly = mineParam === "1";
  const allVisible = (visibleRequests ?? []).filter((r) => !mineOnly || r.requested_by === ctx.id);

  // Pending-first (spec 19 §4 + addendum A2): requested rows by priority
  // band (critical → urgent → normal) then oldest-first; decided rows
  // below newest-first (the history). In-process sort, not SQL ORDER BY:
  // one fetch serves both bands' opposite date orders (deviation from
  // A2's "order by" wording, recorded in the tracker).
  const PRIORITY_RANK: Record<PurchaseRequestPriority, number> = {
    critical: 0,
    urgent: 1,
    normal: 2,
  };
  const pendingRows = allVisible
    .filter((r) => r.status === "requested")
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.requested_at.localeCompare(b.requested_at),
    );
  const decidedRows = allVisible.filter((r) => r.status !== "requested");
  const myRequests = [...pendingRows, ...decidedRows];

  const isDecider = ctx.role === "project_manager" || ctx.role === "super_admin";
  // Spec 33 / ADR 0038: back-office recording gate (PM/procurement/super).
  // The RPCs re-enforce server-side; suppliers are only fetched when the
  // viewer can actually use the form.
  const isBackOffice = isBackOfficeRole(ctx.role);
  let suppliers: SupplierOption[] = [];
  if (isBackOffice) {
    const { data: supplierRows } = await supabase
      .from("suppliers")
      .select("id, name, phone")
      .order("name", { ascending: true });
    suppliers = supplierRows ?? [];
  }
  // Site-wide visibility (A1): every viewer sees requester names now —
  // the operator-sanctioned name exposure recorded in ADR 0026.
  const requesterNames = await fetchDisplayNames(
    Array.from(
      new Set(
        myRequests.map((r) => r.requested_by).filter((id): id is string => typeof id === "string"),
      ),
    ),
    "[requests]",
  );

  // Resolve WP code/name for the list. PostgREST's foreign-table
  // inflection would also work, but a separate query mirrors the
  // pm/page.tsx + current-photos.ts convention and keeps the typed shape
  // legible to readers.
  const wpIdsInRequests = Array.from(new Set(myRequests.map((r) => r.work_package_id)));
  const { data: wpForRequests } = await supabase
    .from("work_packages")
    .select("id, code, name, project_id")
    .in("id", wpIdsInRequests);
  const wpById = new Map((wpForRequests ?? []).map((wp) => [wp.id, wp]));

  // Attachments (spec 23 + spec 16 P2): ONE query against the
  // current-state view (ADR 0009/0015 anti-join pre-encoded) for every
  // visible request, split by purpose/kind for render, then batched
  // signed URLs for exactly the image rows being rendered.
  interface AttachmentRow {
    id: string | null;
    purchase_request_id: string | null;
    kind: string | null;
    purpose: string | null;
    storage_path: string | null;
    url: string | null;
    created_by: string | null;
    created_at: string | null;
  }
  let attachmentRows: AttachmentRow[] = [];
  if (myRequests.length > 0) {
    const { data } = await supabase
      .from("purchase_request_attachments_current")
      .select("id, purchase_request_id, kind, purpose, storage_path, url, created_by, created_at")
      .in(
        "purchase_request_id",
        myRequests.map((r) => r.id),
      )
      .order("created_at", { ascending: true });
    attachmentRows = data ?? [];
  }
  const confirmationsByRequest = new Map<string, AttachmentRow[]>();
  const referenceImagesByRequest = new Map<string, AttachmentRow[]>();
  const referenceLinksByRequest = new Map<string, AttachmentRow[]>();
  for (const row of attachmentRows) {
    if (!row.purchase_request_id) continue;
    const bucket =
      row.purpose === "delivery_confirmation"
        ? confirmationsByRequest
        : row.kind === "image"
          ? referenceImagesByRequest
          : referenceLinksByRequest;
    const list = bucket.get(row.purchase_request_id) ?? [];
    list.push(row);
    bucket.set(row.purchase_request_id, list);
  }
  const attachmentUrls = await mintSignedUrlsForAttachments(
    attachmentRows
      .filter((row) => row.kind === "image")
      .map((row) => ({ id: row.id ?? "", storage_path: row.storage_path })),
  );

  return (
    <main className="min-h-screen bg-white pb-20 text-zinc-900 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="คำขอซื้อ" fullName={ctx.fullName} maxWidthClass="max-w-2xl" />

      {/* Pinned mode keeps the contextual spec-12 back-bar everywhere; in
          bare mode /requests is a TAB ROOT — on phones the bottom tabs
          are the way out and a bare กลับ reads as broken UX (operator
          report 2026-06-11), so the strip is desktop-only there. */}
      <nav
        className={`border-b border-zinc-300 bg-zinc-100 px-5 py-1 ${
          pinnedWp && pinnedProjectId ? "" : "hidden sm:block"
        }`}
      >
        <div className="mx-auto flex max-w-2xl items-center">
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-blue-700 transition-colors hover:underline focus:outline-none focus-visible:underline"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {backLabel}
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-2xl space-y-8 px-5 py-6">
        <div>
          <h2 className="mb-3 text-base font-semibold text-zinc-900">สร้างคำขอซื้อ</h2>
          {pinnedWp && pinnedProjectId ? (
            <PurchaseRequestForm workPackage={pinnedWp} projectId={pinnedProjectId} />
          ) : (
            <div className="space-y-2">
              {wpRequested ? <ErrorNotice>ไม่พบรายการงาน</ErrorNotice> : null}
              <p className="rounded-md border border-zinc-300 bg-zinc-50 px-4 py-4 text-sm text-zinc-600">
                คำขอซื้อเริ่มจากหน้ารายการงาน — เปิดรายการงานที่ต้องการ แล้วกด{" "}
                <span className="font-medium text-zinc-900">สร้างคำขอซื้อ</span>{" "}
                จากนั้นผู้จัดการโครงการจะเป็นผู้พิจารณาอนุมัติ —
                หากไม่อนุมัติจะมีความเห็นแจ้งเหตุผลเสมอ
              </p>
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-900">คำขอซื้อ</h2>
            {/* ของฉัน filter chip (spec 16 A1) — site staff see the whole
                site's requests; the chip narrows back to their own. A live
                pinned WP survives the toggle (chips are a filter, not
                navigation — the form and spec-12 back-bar stay mounted). */}
            <div className="flex gap-1 text-xs">
              <Link
                href={pinnedWp ? `/requests?wp=${pinnedWp.id}` : "/requests"}
                aria-current={!mineOnly ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 ${
                  !mineOnly
                    ? "border-blue-700 bg-blue-700 font-semibold text-white"
                    : "border-zinc-400 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                ทั้งหมด
              </Link>
              <Link
                href={pinnedWp ? `/requests?wp=${pinnedWp.id}&mine=1` : "/requests?mine=1"}
                aria-current={mineOnly ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 ${
                  mineOnly
                    ? "border-blue-700 bg-blue-700 font-semibold text-white"
                    : "border-zinc-400 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                ของฉัน
              </Link>
            </div>
          </div>
          {myError ? (
            <ErrorNotice>โหลดรายการคำขอซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
          ) : myRequests.length === 0 ? (
            <EmptyNotice>{mineOnly ? "คุณยังไม่เคยสร้างคำขอซื้อ" : "ยังไม่มีคำขอซื้อ"}</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2">
              {myRequests.map((r) => {
                const wp = wpById.get(r.work_package_id);
                const status = r.status as PurchaseRequestStatus;
                const priority = r.priority as PurchaseRequestPriority;
                return (
                  <li
                    key={r.id}
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        {wp ? (
                          <p className="truncate text-xs text-zinc-600">
                            <span className="font-mono">{wp.code}</span>
                            <span className="mx-1">·</span>
                            {wp.name}
                          </p>
                        ) : null}
                        <p className="truncate text-base text-zinc-900">
                          {/* PR running number (spec 27) — the phone-callable
                              identity for site ↔ procurement talk. */}
                          <span className="mr-1.5 font-mono text-xs text-zinc-500">
                            PR-{String(r.pr_number).padStart(4, "0")}
                          </span>
                          {r.item_description}
                          <span className="mx-2 text-zinc-400">·</span>
                          <span className="text-zinc-700">
                            {r.quantity} {r.unit}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-600">
                          {/* Own-row marker (spec 25): in the site-wide list,
                              the viewer's requests must be identifiable at a
                              glance, not only via the ของฉัน filter chip. */}
                          {r.requested_by === ctx.id ? (
                            <span className="mr-1.5 inline-flex items-center rounded-full border border-blue-700 bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700">
                              ของฉัน
                            </span>
                          ) : null}
                          ขอซื้อโดย{" "}
                          {(r.requested_by ? requesterNames.get(r.requested_by) : null) ??
                            r.requested_by_email ??
                            "—"}
                          <span className="mx-1 text-zinc-400">·</span>
                          ขอเมื่อ {formatThaiDate(r.requested_at)}
                        </p>
                        {r.needed_by ? (
                          <p className="text-xs text-zinc-600">
                            ต้องการรับของภายใน {formatThaiDate(r.needed_by)}
                          </p>
                        ) : null}
                      </div>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusPill pillClasses={purchaseRequestStatusPillClasses(status)}>
                          {PURCHASE_REQUEST_STATUS_LABEL[status]}
                        </StatusPill>
                        {priority !== "normal" ? (
                          <StatusPill pillClasses={purchaseRequestPriorityPillClasses(priority)}>
                            {PURCHASE_REQUEST_PRIORITY_LABEL[priority]}
                          </StatusPill>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-3">
                      <PurchaseRequestTracker
                        status={status}
                        requestedAt={r.requested_at}
                        decidedAt={r.decided_at}
                        purchasedAt={r.purchased_at}
                        shippedAt={r.shipped_at}
                        deliveredAt={r.delivered_at}
                        eta={r.eta}
                      />
                    </div>
                    {(referenceImagesByRequest.get(r.id) ?? []).length > 0 ? (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-zinc-700">รูปอ้างอิง</p>
                        <ul className="mt-1 flex flex-wrap gap-2">
                          {(referenceImagesByRequest.get(r.id) ?? []).map((photo) => {
                            const url = photo.id ? attachmentUrls.get(photo.id) : undefined;
                            if (!photo.id || !url) return null;
                            return (
                              <li key={photo.id} className="flex flex-col items-center gap-0.5">
                                <span className="block h-20 w-20 overflow-hidden rounded-md border border-zinc-300">
                                  <ZoomablePhoto src={url} />
                                </span>
                                {status === "requested" && photo.created_by === ctx.id ? (
                                  <AttachmentRemoveButton attachmentId={photo.id} />
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {(referenceLinksByRequest.get(r.id) ?? []).length > 0 ? (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-zinc-700">ลิงก์อ้างอิง</p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {(referenceLinksByRequest.get(r.id) ?? []).map((link) => {
                            if (!link.id || !link.url) return null;
                            return (
                              <li key={link.id} className="flex items-center gap-2">
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer nofollow"
                                  className="min-w-0 flex-1 truncate text-xs text-blue-700 underline-offset-2 hover:underline"
                                >
                                  {link.url}
                                </a>
                                {status === "requested" && link.created_by === ctx.id ? (
                                  <AttachmentRemoveButton attachmentId={link.id} />
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {status === "requested" && r.requested_by === ctx.id && wp ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-blue-700 underline-offset-2 hover:underline">
                          เพิ่มรูปหรือลิงก์
                        </summary>
                        <div className="mt-2">
                          <PurchaseRequestAttachmentStager
                            projectId={wp.project_id}
                            purchaseRequestId={r.id}
                          />
                        </div>
                      </details>
                    ) : null}
                    {/* Spec 26 slimming: the tracker already carries the
                        stage dates + ETA — the old อนุมัติเมื่อ /
                        คาดว่าจะได้รับของ / สั่งซื้อเมื่อ / ได้รับของเมื่อ
                        text lines duplicated it. Only facts the tracker
                        does NOT show remain: supplier, receiver, notes. */}
                    {status === "rejected" && r.decision_comment ? (
                      <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2">
                        <p className="text-xs font-medium text-red-900">เหตุผลที่ไม่อนุมัติ</p>
                        <p className="mt-0.5 text-sm whitespace-pre-wrap text-red-800">
                          {r.decision_comment}
                        </p>
                        {r.decided_at ? (
                          <p className="mt-1 text-xs text-red-700">
                            พิจารณาเมื่อ {formatThaiDateTime(r.decided_at)}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {r.supplier || (status === "delivered" && r.received_by) ? (
                      <p className="mt-2 text-xs text-zinc-600">
                        {r.supplier ? `ผู้ขาย ${r.supplier}` : ""}
                        {r.supplier && status === "delivered" && r.received_by ? " · " : ""}
                        {status === "delivered" && r.received_by
                          ? `ผู้รับของ ${r.received_by}`
                          : ""}
                      </p>
                    ) : null}
                    {status === "delivered" && r.delivery_note ? (
                      <p className="mt-1 text-xs whitespace-pre-wrap text-zinc-600">
                        {r.delivery_note}
                      </p>
                    ) : null}
                    {status === "delivered" || status === "on_route" ? (
                      <div className="mt-3 flex flex-col gap-2 border-t border-zinc-200 pt-3">
                        {(confirmationsByRequest.get(r.id) ?? []).length > 0 ? (
                          <div>
                            <p className="text-xs font-medium text-zinc-700">รูปยืนยันการรับของ</p>
                            <ul className="mt-1 flex flex-wrap gap-2">
                              {(confirmationsByRequest.get(r.id) ?? []).map((photo) => {
                                const url = photo.id ? attachmentUrls.get(photo.id) : undefined;
                                if (!photo.id || !url) return null;
                                return (
                                  <li key={photo.id} className="flex flex-col items-center gap-0.5">
                                    <span className="block h-20 w-20 overflow-hidden rounded-md border border-zinc-300">
                                      <ZoomablePhoto src={url} />
                                    </span>
                                    {photo.created_by === ctx.id ? (
                                      <AttachmentRemoveButton attachmentId={photo.id} />
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                        {wp ? (
                          <DeliveryPhotoUploader
                            purchaseRequestId={r.id}
                            projectId={wp.project_id}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {isDecider && status === "requested" ? (
                      <div className="mt-3 border-t border-zinc-300 pt-3">
                        <PurchaseRequestDecision requestId={r.id} />
                      </div>
                    ) : null}
                    {isBackOffice && status === "approved" ? (
                      <div className="mt-3 border-t border-zinc-300 pt-3">
                        {/* Spec 33: in-app purchase recording — parallel
                            path to AppSheet (ADR 0034 amendment). */}
                        <PurchaseRecordForm requestId={r.id} suppliers={suppliers} />
                      </div>
                    ) : null}
                    {isBackOffice && status === "purchased" ? (
                      <div className="mt-3 border-t border-zinc-300 pt-3">
                        <PurchaseRequestShip requestId={r.id} />
                      </div>
                    ) : null}
                    {isDecider && status === "approved" ? (
                      <div className="mt-3 border-t border-zinc-300 pt-3">
                        <PurchaseRequestCancel requestId={r.id} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {myRequests && myRequests.length > 0 ? (
            <p className="mt-3 text-xs text-zinc-600">
              เมื่อผู้จัดการโครงการอนุมัติคำขอแล้ว
              ฝ่ายจัดซื้อบันทึกการสั่งซื้อและการจัดส่งได้ทั้งในหน้านี้และในระบบหลังบ้าน — สถานะ
              &ldquo;สั่งซื้อแล้ว&rdquo; และ &ldquo;กำลังจัดส่ง&rdquo; จะอัปเดตอัตโนมัติจากบันทึก
              เมื่อของถึงหน้างาน ถ่ายรูปยืนยันการรับของได้ทันทีที่สถานะ &ldquo;กำลังจัดส่ง&rdquo; —
              ระบบจะบันทึกเป็น &ldquo;ได้รับของแล้ว&rdquo; ให้อัตโนมัติ
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
