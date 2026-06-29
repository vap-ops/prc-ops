import Link from "next/link";
import { Camera } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, DETAIL_TITLE } from "@/lib/ui/classes";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { WP_DETAIL_ROLES, isManagerRole, isReadOnlyWpViewer } from "@/lib/auth/role-home";
import { projectHref, workPackageHref } from "@/lib/nav/project-paths";
import { safeBackHref } from "@/lib/nav/back-href";
import { createClient } from "@/lib/db/server";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { CATALOG_IMAGES_BUCKET } from "@/lib/storage/buckets";
import { loadCatalogCategories, categoryNameById } from "@/lib/catalog/categories";
import { latestCreatedAt, PHASES } from "@/lib/photos/phases";
import { groupAfterFixByRound, afterFixRoundHeading } from "@/lib/photos/rework-round";
import { derivePhaseProgress } from "@/lib/photos/phase-progress";
import { TRANSITIONABLE_FROM_STATUSES } from "@/lib/photos/transitions";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { StatusPill } from "@/components/features/common/status-pill";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { WorkPackageInfoButton } from "@/components/features/work-packages/work-package-info-button";
import { PurchaseRequestCard } from "@/components/features/purchasing/purchase-request-card";
import {
  APPROVAL_DECISION_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  EQUIPMENT_TAB_LABEL,
  PHOTO_PHASE_LABEL,
  reworkSourceLabel,
  formatThaiDateTime,
  formatThaiTime,
} from "@/lib/i18n/labels";
import { AttentionCard } from "@/components/features/common/attention-card";
import { CountChip } from "@/components/features/common/count-chip";
import { PhaseProgressBar } from "@/components/features/work-packages/phase-progress-bar";
import {
  approvalDecisionPillClasses,
  workPackageStatusPillClasses,
  type PurchaseRequestPriority,
  type PurchaseRequestStatus,
} from "@/lib/status-colors";
import { approvalDecisionIcon, workPackageStatusIcon } from "@/lib/status-icons";
import { loadWorkPackageDetail } from "@/lib/work-packages/load-detail";
import { WpAssignmentPanel } from "@/components/features/work-packages/wp-assignment-panel";
import { WpPriorityControl } from "@/components/features/work-packages/wp-priority-control";
import { WpDeliverableControl } from "@/components/features/work-packages/wp-deliverable-control";
import { WpNameControl } from "@/components/features/work-packages/wp-name-control";
import { WpDeleteControl } from "@/components/features/work-packages/wp-delete-control";
import { WpSchedulePanel } from "@/components/features/work-packages/wp-schedule-panel";
import { WpDetailTabs, type WpDetailTab } from "@/components/features/work-packages/wp-detail-tabs";
import { WorkPackageNotes } from "@/components/features/work-packages/work-package-notes";
import {
  PurchaseRequestForm,
  type PurchaseRequestCatalogItem,
} from "@/components/features/purchasing/purchase-request-form";
import { SelfPurchaseSection } from "@/components/features/purchasing/self-purchase-section";
import {
  WpIssueStock,
  type WpIssueRow,
  type WpStockRow,
} from "@/components/features/store/wp-issue-stock";
import { PhaseGallery } from "@/components/features/photos/phase-gallery";
import { LaborLogZone } from "@/components/features/labor/labor-log-zone";
import { LaborBudgetCard } from "@/components/features/labor/labor-budget-card";
import { fetchWpLaborBudgetSummary } from "@/lib/labor/wp-budget-summary";
import { WpEquipmentZone } from "@/components/features/equipment/wp-equipment-zone";
import { splitEquipmentUsage } from "@/lib/equipment/usage-rows";
import { bangkokTodayIso } from "@/lib/dates";
import { PhotoCaptureZone } from "./phase-uploader";
import { ReportDefectControl } from "./report-defect-control";
import { SubmitForApprovalControl } from "./submit-for-approval-control";

interface PageProps {
  params: Promise<{ projectId: string; workPackageId: string }>;
  // The back chip follows where you came from — /sa, the schedule, a purchase
  // request, a งวด — falling back to the project page (see safeBackHref).
  searchParams: Promise<{ from?: string }>;
}

export const metadata = { title: "รูปถ่ายงาน" };

export default async function WorkPackagePhotoScreen({ params, searchParams }: PageProps) {
  const { projectId, workPackageId } = await params;
  const { from } = await searchParams;
  const ctx = await requireRole(WP_DETAIL_ROLES);
  const supabase = await createClient();
  // Spec 171: procurement opens this screen to raise a purchase request, seeing
  // it like a site admin but READ-ONLY everywhere except the request. One flag
  // drives the suppression of every write affordance below.
  const readOnly = isReadOnlyWpViewer(ctx.role);
  const isAssigner = !readOnly;
  const isPlanner = isManagerRole(ctx.role);

  // Spec 147 U1: one loader batches the WP-detail reads (was a serial
  // waterfall). Same queries/columns/results — only the scheduling changes.
  // Spec 155: the project's deliverables feed the planner-only bind control;
  // it depends only on projectId, so it rides alongside the loader (no waterfall).
  // Spec 177 U5: a site staffer can เบิก stock from the project store TO this WP.
  // The picker needs the project's on-hand (qty > 0) and this WP's recent issues;
  // both ride the Promise.all (no waterfall). The เบิก control itself renders only
  // for !readOnly — procurement may read these rows but never draws stock.
  const [
    data,
    { data: projectDeliverables },
    { data: ohRows },
    { data: issueRows },
    { data: returnRows },
    { data: wkRows },
    { data: catalogRows },
    catalogCategories,
    { data: eqItemRows },
    { data: eqUsageRows },
    laborBudget,
  ] = await Promise.all([
    loadWorkPackageDetail(supabase, { workPackageId, projectId, isPlanner }),
    isPlanner
      ? supabase
          .from("deliverables")
          .select("id, code, name")
          .eq("project_id", projectId)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
    supabase
      .from("stock_on_hand")
      .select("catalog_item_id, qty_on_hand, catalog_items ( base_item, spec_attrs, unit )")
      .eq("project_id", projectId)
      .gt("qty_on_hand", 0),
    supabase
      .from("stock_issues")
      .select(
        "id, qty, unit, unit_cost, receiver_worker_id, received_at, catalog_items ( base_item, spec_attrs )",
      )
      .eq("work_package_id", workPackageId)
      .order("issued_at", { ascending: false })
      .limit(10),
    // Spec 209 U2: returns booked against this WP's issues — to show the
    // remaining-returnable per issued line (issued − Σ returns).
    supabase.from("stock_returns").select("issue_id, qty").eq("work_package_id", workPackageId),
    // Spec 177 U7: the project's active workers — the receiver picker for เบิก.
    supabase
      .from("workers")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("active", true)
      .order("name", { ascending: true }),
    // Spec 179: the active catalog master feeds the คำขอซื้อ item picker
    // (project-agnostic reference data; readable by any authenticated user).
    // Spec 180: image_path rides along for the picker's thumbnails.
    // Spec 214: product_code rides along so the picker searches by code.
    // Spec 221 cleanup: read category_id (the managed FK), not the vestigial enum.
    supabase
      .from("catalog_items")
      .select("id, category_id, base_item, spec_attrs, unit, image_path, product_code")
      .eq("is_active", true)
      .order("base_item", { ascending: true }),
    // Spec 221 cleanup: the managed main categories (id + name + order) for the
    // picker's grouping; rides the Promise.all (no waterfall).
    loadCatalogCategories(supabase),
    // Spec 202 U2: the อุปกรณ์ tab. The registry (RATE-FREE — daily_rate is
    // admin-only and omitted) feeds the check-out picker; this WP's usage spans
    // feed the open/history lists. Both RLS-readable by WP_DETAIL_ROLES; no money.
    supabase
      .from("equipment_items")
      .select("id, name, asset_tag")
      .order("name", { ascending: true }),
    supabase
      .from("equipment_usage_logs")
      .select("id, item_id, checked_out_on, checked_in_on, superseded_by")
      .eq("work_package_id", workPackageId)
      .order("created_at", { ascending: true }),
    // Spec 205 U3: the labor budget vs actual for the จัดการ tab — MONEY, so only
    // for the planner (PM/PD/super); a site_admin/procurement view never reads it.
    isPlanner ? fetchWpLaborBudgetSummary(workPackageId) : Promise.resolve(null),
  ]);
  if (!data.wp) {
    notFound();
  }
  const wp = data.wp;
  const {
    contractors,
    approvals,
    wpRequests,
    siblingWps,
    predecessorIds,
    labor,
    photosByPhase,
    signedUrls,
    displayNames,
    defectReason,
    reworkReasons,
    reworkSources,
    defectSource,
  } = data;

  const assignedContractor = wp.contractor_id
    ? (contractors.find((c) => c.id === wp.contractor_id) ?? null)
    : null;
  const pickerContractors = contractors
    .filter((c) => c.status !== "blacklisted" || c.id === wp.contractor_id)
    .map(({ id, name, phone }) => ({ id, name, phone }));

  const latestDecision = approvals[0] ?? null;
  const attention =
    latestDecision &&
    (latestDecision.decision === "needs_revision" || latestDecision.decision === "rejected")
      ? latestDecision
      : null;

  const predSet = new Set(predecessorIds);
  const predecessorOptions = siblingWps.filter((w) => predSet.has(w.id));
  const candidateOptions = siblingWps.filter((w) => !predSet.has(w.id));

  const requestedCount = wpRequests.filter((r) => r.status === "requested").length;

  // Field-First: one capture zone for all three phases; the shutter opens
  // pre-set to the current phase (server-derived from the same progress
  // helper the bar uses).
  const phaseCounts = {
    before: photosByPhase.before.length,
    during: photosByPhase.during.length,
    after: photosByPhase.after.length,
    // after_fix is a rework addendum, not part of the 3-step progress derivation
    // (PHASE_ORDER), but the Record<PhotoPhase, number> shape requires the key.
    after_fix: photosByPhase.after_fix.length,
  };
  const currentPhase = derivePhaseProgress(phaseCounts).currentPhase;
  // Spec 216: the หลังแก้ไข rework bucket surfaces only inside a rework cycle (in
  // rework OR already has after_fix photos); a WP can be reworked more than once, so
  // its photos group by round (each with the defect reason that opened it).
  const showAfterFix = wp.status === "rework" || photosByPhase.after_fix.length > 0;
  const afterFixRounds = groupAfterFixByRound(photosByPhase.after_fix);
  // Feedback a6037564: a PD wants to know who uploaded each photo. uploaded_by
  // is already on every photo_logs row; resolve the names once (admin read,
  // same pattern as photo-markups) and surface them in the lightbox.
  const uploaderNames = await fetchDisplayNames(
    Array.from(
      new Set(PHASES.flatMap(({ phase }) => photosByPhase[phase].map((p) => p.uploaded_by))),
    ),
    "[wp-photos]",
  );
  const phaseData = PHASES.map(({ phase, label }) => {
    const rows = photosByPhase[phase];
    const latest = latestCreatedAt(rows);
    return {
      phase,
      label,
      photos: rows.map((p) => ({
        id: p.id,
        url: signedUrls.get(p.id) ?? null,
        timeLabel: formatThaiTime(p.captured_at_client ?? p.created_at),
        uploaderName: uploaderNames.get(p.uploaded_by) ?? null,
      })),
      lastUpdatedLabel: latest ? formatThaiTime(latest) : null,
    };
  });

  // Spec 177 U5/U7: shape the store reads for the WP เบิก control.
  const wpWorkers = (wkRows ?? []).map((w) => ({ id: w.id, name: w.name }));
  const workerNames = new Map(wpWorkers.map((w) => [w.id, w.name]));
  const wpOnHand: WpStockRow[] = (ohRows ?? []).map((r) => ({
    catalogItemId: r.catalog_item_id,
    baseItem: r.catalog_items?.base_item ?? "",
    specAttrs: r.catalog_items?.spec_attrs ?? null,
    unit: r.catalog_items?.unit ?? "",
    qtyOnHand: Number(r.qty_on_hand),
  }));
  // Spec 179/180: the catalog master for the คำขอซื้อ item picker, with signed
  // thumbnail URLs (private bucket → service-role signed URLs; rows already read
  // under the user's RLS).
  const catalogThumbs = await mintSignedUrls(
    CATALOG_IMAGES_BUCKET,
    (catalogRows ?? []).map((r) => ({ id: r.id, storage_path: r.image_path })),
  );
  // Spec 221 cleanup: read the managed category (id + name) so user-created
  // categories group + label correctly; the item_category enum is no longer read.
  const categoryName = categoryNameById(catalogCategories);
  const catalogCategoryList = catalogCategories.map((c) => ({ id: c.id, name: c.name }));
  const catalogItems: PurchaseRequestCatalogItem[] = (catalogRows ?? []).map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    categoryName: r.category_id ? (categoryName.get(r.category_id) ?? "") : "",
    baseItem: r.base_item,
    specAttrs: r.spec_attrs,
    unit: r.unit,
    thumbnailUrl: catalogThumbs.get(r.id) ?? null,
    productCode: r.product_code,
  }));

  // Spec 209 U2: Σ returned qty per issue, to derive the remaining-returnable.
  const returnedByIssue = new Map<string, number>();
  for (const r of returnRows ?? []) {
    returnedByIssue.set(r.issue_id, (returnedByIssue.get(r.issue_id) ?? 0) + Number(r.qty));
  }

  const wpIssues: WpIssueRow[] = (issueRows ?? []).map((r) => ({
    id: r.id,
    baseItem: r.catalog_items?.base_item ?? "",
    specAttrs: r.catalog_items?.spec_attrs ?? null,
    unit: r.unit,
    qty: Number(r.qty),
    unitCost: Number(r.unit_cost),
    receiverName: r.receiver_worker_id ? (workerNames.get(r.receiver_worker_id) ?? "—") : null,
    receivedAt: r.received_at,
    returnedQty: returnedByIssue.get(r.id) ?? 0,
  }));

  // Spec 202 U2: shape the equipment usage tab (rate-free). The picker lists every
  // visible item; open/history come from the supersede anti-join.
  const equipmentItems = (eqItemRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    assetTag: r.asset_tag,
  }));
  const equipmentItemNames = Object.fromEntries(equipmentItems.map((i) => [i.id, i.name]));
  const { open: equipmentOpen, history: equipmentHistory } = splitEquipmentUsage(eqUsageRows ?? []);

  // Spec 167: the body folds into segmented tabs. Order = the SA's frequency
  // (capture first, then purchases, labor, reference info); the planner-only
  // จัดการ tab is appended last. Panels are server-rendered here and handed to
  // the client switcher as slots — one fetch, one render, focused view.
  const tabs: WpDetailTab[] = [
    {
      key: "photos",
      label: "รูปถ่าย",
      panel: readOnly ? (
        // Spec 171: procurement views the photos read-only — the PM-side gallery,
        // not the capture zone (which owns the thumb-anchored shutter bar).
        // Spec 216: lifecycle phases first, then one หลังแก้ไข section per rework
        // round (each with the defect reason that opened it) — only when reworked.
        <div className="flex flex-col gap-5">
          {PHASES.filter(({ phase }) => phase !== "after_fix").map(({ phase, label }) => (
            <PhaseGallery
              key={phase}
              label={label}
              photos={photosByPhase[phase]}
              signedUrls={signedUrls}
              uploaderNames={uploaderNames}
            />
          ))}
          {showAfterFix
            ? afterFixRounds.map(({ round, photos }) => (
                <PhaseGallery
                  key={`after_fix-${round}`}
                  label={afterFixRoundHeading(
                    PHOTO_PHASE_LABEL.after_fix,
                    round,
                    reworkSourceLabel(reworkSources.get(round)),
                  )}
                  photos={photos}
                  signedUrls={signedUrls}
                  uploaderNames={uploaderNames}
                  note={reworkReasons.get(round) ?? null}
                />
              ))
            : null}
        </div>
      ) : (
        <PhotoCaptureZone
          projectId={wp.project_id}
          workPackageId={wp.id}
          userId={ctx.id}
          phases={phaseData}
          currentPhase={currentPhase}
          showAfterFix={showAfterFix}
          currentReworkRound={wp.rework_round}
        />
      ),
    },
    {
      key: "purchases",
      label: "คำขอซื้อ",
      panel: (
        <>
          <details className={CARD}>
            <summary className="text-body text-ink cursor-pointer font-semibold">
              สร้างคำขอซื้อ
            </summary>
            <div className="mt-3">
              <PurchaseRequestForm
                workPackage={{ id: wp.id, code: wp.code, name: wp.name }}
                projectId={wp.project_id}
                userId={ctx.id}
                catalogItems={catalogItems}
                categories={catalogCategoryList}
              />
            </div>
          </details>
          {/* Spec 211 U11a: self-purchase (จ่ายเงินเองหน้างาน) consolidated in ONE
              place — บันทึกการซื้อหน้างาน (off-catalog + invoice) AND ซื้อเงินสด
              ใช้ที่งานนี้เลย (catalogued cash, was in the เบิกของ tab). Both calls'
              RPC gates exclude procurement → hidden for the read-only viewer. The PR
              path (สร้างคำขอซื้อ, above) stays its own affordance — "PR is PR". */}
          {!readOnly ? (
            <SelfPurchaseSection
              projectId={wp.project_id}
              workPackageId={wp.id}
              catalogItems={catalogItems}
              categories={catalogCategoryList}
            />
          ) : null}
          {(wpRequests ?? []).length > 0 ? (
            <ul className="flex flex-col gap-2">
              {(wpRequests ?? []).map((r) => (
                <li key={r.id}>
                  <PurchaseRequestCard
                    request={{
                      id: r.id,
                      pr_number: r.pr_number,
                      item_description: r.item_description,
                      quantity: r.quantity,
                      unit: r.unit,
                      status: r.status as PurchaseRequestStatus,
                      priority: r.priority as PurchaseRequestPriority,
                      requested_at: r.requested_at,
                      needed_by: r.needed_by,
                      decided_at: r.decided_at,
                      purchased_at: r.purchased_at,
                      shipped_at: r.shipped_at,
                      delivered_at: r.delivered_at,
                      eta: r.eta,
                    }}
                    workPackage={null}
                    requesterName={
                      (r.requested_by ? displayNames.get(r.requested_by) : null) ??
                      r.requested_by_email ??
                      null
                    }
                    isMine={r.requested_by === ctx.id}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ),
    },
    {
      key: "labor",
      label: "ทีมงาน",
      panel: (
        <LaborLogZone
          workPackageId={wp.id}
          revalidate={workPackageHref(projectId, workPackageId)}
          roster={labor.roster}
          rows={labor.rows}
          projectWorkerIds={labor.projectWorkerIds}
          // Spec 171: procurement reads labour history only — no flags, no capture
          // (locked drops the capture form and the per-row edit button).
          showFlags={!readOnly && ctx.role !== "site_admin"}
          locked={readOnly || wp.status === "complete"}
        />
      ),
    },
    {
      // Spec 202 U2: check equipment out/in to this WP. Rate-free (no money on
      // screen) — same locked posture as labor (procurement reads history; the
      // field checks out; a complete WP is read-only).
      key: "equipment",
      label: EQUIPMENT_TAB_LABEL,
      panel: (
        <WpEquipmentZone
          workPackageId={wp.id}
          revalidate={workPackageHref(projectId, workPackageId)}
          items={equipmentItems}
          itemNames={equipmentItemNames}
          open={equipmentOpen}
          history={equipmentHistory}
          locked={readOnly || wp.status === "complete"}
          defaultDate={bangkokTodayIso()}
        />
      ),
    },
    {
      key: "info",
      label: "ข้อมูล",
      panel: (
        <>
          <div className={CARD}>
            {readOnly ? (
              // Spec 171: notes are read-only for procurement (no editor).
              <>
                <p className="text-ink text-sm font-medium">หมายเหตุ</p>
                <p className="text-ink-secondary mt-1 text-sm whitespace-pre-wrap">
                  {wp.notes?.trim() ? wp.notes : "—"}
                </p>
              </>
            ) : (
              <WorkPackageNotes projectId={wp.project_id} workPackageId={wp.id} notes={wp.notes} />
            )}
          </div>
          {/* Spec 94: รายละเอียดงาน (description) lives in the header ⓘ sheet. */}
          {approvals.length > 0 ? (
            <details className={CARD}>
              <summary className="text-body text-ink cursor-pointer font-semibold">
                ประวัติการตรวจ ({approvals.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {approvals.map((a) => (
                  <li key={a.id} className="border-edge border-t pt-2 first:border-t-0">
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill
                        pillClasses={approvalDecisionPillClasses(a.decision)}
                        icon={approvalDecisionIcon(a.decision)}
                      >
                        {APPROVAL_DECISION_LABEL[a.decision]}
                      </StatusPill>
                      <span className="text-meta text-ink-secondary">
                        {displayNames.get(a.decided_by) ?? "—"} · {formatThaiDateTime(a.decided_at)}
                      </span>
                    </div>
                    {a.comment ? (
                      <p className="text-body text-ink-secondary mt-1 whitespace-pre-wrap">
                        {a.comment}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ),
    },
  ];

  // Spec 208 U2: เบิก gets its own first-class tab on the WP detail page (operator
  // 2026-06-26: withdrawals are made on the WP page, not buried in คำขอซื้อ). Placed
  // right after คำขอซื้อ (purchase → withdraw flow). issue_stock's gate excludes
  // procurement, so the tab only appears for site staff (!readOnly).
  if (!readOnly) {
    const purchasesIdx = tabs.findIndex((t) => t.key === "purchases");
    tabs.splice(purchasesIdx + 1, 0, {
      key: "issue",
      label: "เบิกของ",
      panel: (
        <div className="flex flex-col gap-4">
          <div className={CARD}>
            <WpIssueStock
              projectId={wp.project_id}
              workPackageId={wp.id}
              onHand={wpOnHand}
              workers={wpWorkers}
              issues={wpIssues}
            />
          </div>
          {/* Spec 211 U11a: the on-site cash buy (ซื้อเงินสด ใช้ที่งานนี้เลย) moved
              to the consolidated ซื้อเอง self-purchase section in the คำขอซื้อ tab —
              this tab is now the pure เบิก (withdraw) surface. */}
        </div>
      ),
    });
  }

  // PM/super/director management: rename · priority · งวดงาน bind · schedule +
  // dependencies · delete-empty. Tucked behind its own tab so it no longer
  // pushes the capture hero down for planners (spec 92/155/156/157).
  if (isPlanner) {
    tabs.push({
      key: "manage",
      label: "จัดการ",
      panel: (
        <>
          {/* Spec 205 U3: the labor budget (money) lives here — the everyday
              manage surface, already planner-gated so site staff never see it. */}
          {laborBudget ? (
            <LaborBudgetCard
              summary={laborBudget}
              workPackageId={wp.id}
              revalidate={workPackageHref(projectId, workPackageId)}
            />
          ) : null}
          <WpNameControl projectId={wp.project_id} workPackageId={wp.id} name={wp.name} />
          <WpPriorityControl
            projectId={wp.project_id}
            workPackageId={wp.id}
            priority={wp.priority}
          />
          <WpDeliverableControl
            projectId={wp.project_id}
            workPackageId={wp.id}
            deliverableId={wp.deliverable_id}
            deliverables={projectDeliverables ?? []}
          />
          <WpSchedulePanel
            projectId={wp.project_id}
            workPackageId={wp.id}
            plannedStart={wp.planned_start}
            plannedEnd={wp.planned_end}
            predecessors={predecessorOptions}
            candidates={candidateOptions}
          />
          {/* Spec 157: delete an empty WP (created by mistake); a WP with
              history is refused (P0001). Destructive — sits last, divided off. */}
          <div className="border-edge border-t pt-4">
            <WpDeleteControl projectId={wp.project_id} workPackageId={wp.id} />
          </div>
        </>
      ),
    });
  }

  return (
    <PageShell>
      {/* Field-First: the tab bar gives way to the thumb-anchored capture
          bar on this detail screen; the back chip handles return nav. */}
      <DetailHeader
        backHref={safeBackHref(from, projectHref(projectId))}
        backLabel="กลับ"
        actions={
          // Spec 94: contractor (display + reassign) + the read-only description
          // fold into this ⓘ sheet so the header stays the WP nameplate.
          assignedContractor || wp.description ? (
            <WorkPackageInfoButton
              projectId={wp.project_id}
              workPackageId={wp.id}
              contractor={
                assignedContractor
                  ? { name: assignedContractor.name, phone: assignedContractor.phone }
                  : null
              }
              description={wp.description}
              isAssigner={isAssigner}
              contractors={pickerContractors}
              contractorId={wp.contractor_id}
            />
          ) : null
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-meta text-ink-secondary font-mono">{wp.code}</p>
            {/* Spec 57: WP name never truncates — the nameplate. */}
            <h1 className={DETAIL_TITLE}>{wp.name}</h1>
          </div>
          <StatusPill
            pillClasses={workPackageStatusPillClasses(wp.status)}
            icon={workPackageStatusIcon(wp.status)}
            className="mt-1"
          >
            {WORK_PACKAGE_STATUS_LABEL[wp.status as keyof typeof WORK_PACKAGE_STATUS_LABEL] ??
              wp.status}
          </StatusPill>
        </div>
      </DetailHeader>

      <div className="border-edge bg-card border-b px-5 py-3">
        <div className={`mx-auto ${PAGE_MAX_W}`}>
          <PhaseProgressBar counts={phaseCounts} />
        </div>
      </div>

      {/* Spec 167: the planner management block moved into the จัดการ tab. */}

      {/* Attention stack: PM decision feedback, the unassigned-contractor
          card, and the pending-requests chip. */}
      {attention || !assignedContractor || requestedCount > 0 ? (
        <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3 px-5 pt-5`}>
          {attention ? (
            <AttentionCard
              tone={attention.decision === "rejected" ? "red" : "amber"}
              title={APPROVAL_DECISION_LABEL[attention.decision]}
            >
              <p className="text-meta text-ink-secondary">
                {displayNames.get(attention.decided_by) ?? "—"} ·{" "}
                {formatThaiDateTime(attention.decided_at)}
              </p>
              {attention.comment ? (
                <p className="mt-1 whitespace-pre-wrap">{attention.comment}</p>
              ) : null}
              {/* Spec 218: the SA's next action — add the photos the PM asked for. */}
              {!readOnly ? (
                <Link
                  href="#wp-photos"
                  className="bg-attn-press text-on-attn rounded-control focus-visible:ring-action mt-2.5 inline-flex h-9 items-center gap-1.5 px-3 text-sm font-bold focus:outline-none focus-visible:ring-2"
                >
                  <Camera aria-hidden className="size-4" />
                  ถ่ายรูปเพิ่ม
                </Link>
              ) : null}
            </AttentionCard>
          ) : null}
          {!assignedContractor && isAssigner ? (
            <AttentionCard tone="amber" title="ต้องมอบหมายผู้รับเหมาก่อนเริ่มงาน">
              <p>งานนี้ยังไม่มีผู้รับเหมา — เลือกจากรายชื่อ หรือเพิ่มใหม่</p>
              <div className="mt-2">
                <WpAssignmentPanel
                  projectId={wp.project_id}
                  workPackageId={wp.id}
                  contractors={contractors}
                  contractorId={wp.contractor_id}
                />
              </div>
            </AttentionCard>
          ) : null}
          <CountChip count={requestedCount} label="คำขอซื้อรออนุมัติ" href="#wp-requests" />
        </div>
      ) : null}

      {/* Spec 144: defect rework. A reopened WP shows its defect reason; a
          complete WP offers "report defect" (reopens to rework). */}
      {wp.status === "rework" ? (
        <div className={`mx-auto ${PAGE_MAX_W} px-5 pt-5`}>
          <AttentionCard tone="amber" title="งานแก้ไข — เปิดใหม่จากข้อบกพร่อง">
            {/* Spec 217: who called this rework (ตรวจภายใน / ลูกค้าแจ้ง). */}
            {defectSource ? (
              <p className="text-meta text-ink-secondary mb-1 font-semibold">
                ที่มา: {reworkSourceLabel(defectSource)}
              </p>
            ) : null}
            {defectReason ? (
              <p className="whitespace-pre-wrap">{defectReason}</p>
            ) : (
              <p className="text-ink-secondary">แก้ไขแล้วถ่ายรูปใหม่เพื่อส่งตรวจอีกครั้ง</p>
            )}
            {/* Spec 218: the SA's next action — capture หลังแก้ไข; then ส่งงานเข้าตรวจ
                (the FB2 submit control below) sends it back to review. */}
            {!readOnly ? (
              <Link
                href="#wp-photos"
                className="bg-attn-press text-on-attn rounded-control focus-visible:ring-action mt-2.5 inline-flex h-9 items-center gap-1.5 px-3 text-sm font-bold focus:outline-none focus-visible:ring-2"
              >
                <Camera aria-hidden className="size-4" />
                ถ่ายรูปหลังแก้ไข
              </Link>
            ) : null}
          </AttentionCard>
        </div>
      ) : null}
      {/* FB2 (b9e942f0): explicit "ส่งงานเข้าตรวจ" — replaces the photo auto-flip.
          Shown to non-read-only site staff while the WP is still pre-approval
          (TRANSITIONABLE); the action's SQL guard no-ops on pending/complete. */}
      {!readOnly && (TRANSITIONABLE_FROM_STATUSES as readonly string[]).includes(wp.status) ? (
        <div className={`mx-auto ${PAGE_MAX_W} flex justify-end px-5 pt-5`}>
          <SubmitForApprovalControl projectId={wp.project_id} workPackageId={wp.id} />
        </div>
      ) : null}
      {wp.status === "complete" && !readOnly ? (
        <div className={`mx-auto ${PAGE_MAX_W} flex justify-end px-5 pt-5`}>
          <ReportDefectControl projectId={wp.project_id} workPackageId={wp.id} />
        </div>
      ) : null}

      {/* Spec 167: photos / purchases / labor / info (+ จัดการ for planners)
          fold into segmented tabs — each visit shows only the relevant
          section. The pending-requests chip (#wp-requests) opens คำขอซื้อ. */}
      <WpDetailTabs
        tabs={tabs}
        hashTabMap={{
          "wp-requests": "purchases",
          "wp-photos": "photos",
          "wp-labor": "labor",
          "wp-equipment": "equipment",
          "wp-issue": "issue",
        }}
      />
    </PageShell>
  );
}
