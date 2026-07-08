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
import {
  loadCatalogCategories,
  categoryNameById,
  loadCatalogItemMemberships,
  membershipsByItem,
} from "@/lib/catalog/categories";
import { resolveScopedCategories } from "@/lib/catalog/scoped-categories";
import { latestCreatedAt, PHASES } from "@/lib/photos/phases";
import { groupAfterFixByRound, afterFixRoundHeading } from "@/lib/photos/rework-round";
import { pairDefectPhotos } from "@/lib/photos/defect-pairing";
import { derivePhaseProgress } from "@/lib/photos/phase-progress";
import { submitGateReason, TRANSITIONABLE_FROM_STATUSES } from "@/lib/photos/transitions";
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
  SITE_EXPENSE_TAB_LABEL,
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
import { pickableContractors } from "@/lib/work-packages/contractor-picker";
import { wpWalkFrom } from "@/lib/work-packages/wp-walk";
import { WpWalkBar } from "@/components/features/work-packages/wp-walk-bar";
import { loadGroupChildren, loadGroupMoney } from "@/lib/work-packages/load-group-detail";
import { GroupDetailView } from "@/components/features/work-packages/group-detail-view";
import { WpParentCrumb } from "@/components/features/work-packages/wp-parent-crumb";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { WpAssignmentPanel } from "@/components/features/work-packages/wp-assignment-panel";
import { WpPriorityControl } from "@/components/features/work-packages/wp-priority-control";
import { WpDeliverableControl } from "@/components/features/work-packages/wp-deliverable-control";
import { WpCategoryControl } from "@/components/features/work-packages/wp-category-control";
import { WorkCategoryBadge } from "@/components/features/work-packages/work-category-badge";
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
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
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

  // Spec 270 U4: a งาน (group WP) is a grouping entity — its detail is the
  // oversight view (children + derived rollup + read-only aggregates), never
  // the capture/PR/labor machinery below. One cheap pre-read decides the
  // branch; the leaf path also reads its parent for the breadcrumb.
  const { data: pre } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id, is_group, parent_id")
    .eq("id", workPackageId)
    .maybeSingle();
  if (!pre || pre.project_id !== projectId) notFound();

  if (pre.is_group) {
    const children = await loadGroupChildren(supabase, pre.id);
    // Money = leaf-bound sums (returns netted) — manager tier only, admin
    // client behind that gate (dashboard posture).
    const money = isPlanner
      ? await loadGroupMoney(
          createAdminClient(),
          projectId,
          children.map((c) => c.id),
        )
      : null;
    return (
      <PageShell>
        <DetailHeader backHref={safeBackHref(from, projectHref(projectId))} backLabel="กลับ">
          <div className="min-w-0">
            <p className="text-meta text-ink-secondary font-mono">{pre.code}</p>
            <h1 className={DETAIL_TITLE}>{pre.name}</h1>
          </div>
        </DetailHeader>
        <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
          <GroupDetailView
            projectId={projectId}
            group={{ id: pre.id, code: pre.code, name: pre.name, status: pre.status }}
            childItems={children.map((c) => ({
              id: c.id,
              code: c.code,
              name: c.name,
              status: c.status,
              hasContractor: c.contractor_id !== null,
              priority: c.priority,
              isCritical: false,
            }))}
            money={money}
            canOpenChildren
          />
        </section>
      </PageShell>
    );
  }

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
    { data: projectCategories },
    { data: ohRows },
    { data: issueRows },
    { data: returnRows },
    { data: wkRows },
    { data: catalogRows },
    catalogCategories,
    { data: eqItemRows },
    { data: eqUsageRows },
    laborBudget,
    { data: parentRow },
    { data: walkRows },
  ] = await Promise.all([
    loadWorkPackageDetail(supabase, { workPackageId, projectId, isPlanner }),
    isPlanner
      ? supabase
          .from("deliverables")
          .select("id, code, name")
          .eq("project_id", projectId)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
    // Spec 226 / 207 U3c: the project's work-categories feed the planner-only
    // WpCategoryControl. Load ALL (incl. inactive) so a WP bound to a now-inactive
    // category still renders it; the picker filters active-only client-side.
    isPlanner
      ? supabase
          .from("project_categories")
          .select("id, code, name, is_active")
          .eq("project_id", projectId)
          .order("sort_order", { ascending: true })
      : Promise.resolve({
          data: [] as { id: string; code: string; name: string; is_active: boolean }[],
        }),
    // Spec 229 (ADR 0066 / S8): category_id + kind ride along so the เบิก picker
    // can scope the on-hand list to the WP's work-category (Relation R, kind-aware).
    supabase
      .from("stock_on_hand")
      .select(
        "catalog_item_id, qty_on_hand, catalog_items ( base_item, spec_attrs, unit, category_id, kind )",
      )
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
    // Spec 270 U4: the parent งาน (code + name) for the breadcrumb — only a
    // grouped งานย่อย has one; legacy rows skip the read.
    pre.parent_id
      ? supabase
          .from("work_packages")
          .select("id, code, name")
          .eq("id", pre.parent_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Spec 278 U1: the project's leaf WPs feed the "งานถัดไป" walk (id/code/status,
    // RLS-scoped to the SA's project); the pure wpWalkFrom orders + resolves them.
    supabase
      .from("work_packages")
      .select("id, code, status")
      .eq("project_id", projectId)
      .eq("is_group", false),
  ]);
  if (!data.wp) {
    notFound();
  }
  // Spec 278 U1: prev/next in the work walk, so a photo→next-WP move is one tap.
  const walk = wpWalkFrom(walkRows ?? [], workPackageId);
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
  const pickerContractors = pickableContractors(contractors, wp.contractor_id);

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
    // after_fix and defect are rework addenda, not part of the 3-step progress
    // derivation (PHASE_ORDER), but the Record<PhotoPhase, number> shape
    // requires every key.
    after_fix: photosByPhase.after_fix.length,
    defect: photosByPhase.defect.length,
  };
  const currentPhase = derivePhaseProgress(phaseCounts).currentPhase;
  // Spec 216: the หลังแก้ไข rework bucket surfaces only inside a rework cycle (in
  // rework OR already has after_fix photos); a WP can be reworked more than once, so
  // its photos group by round (each with the defect reason that opened it).
  const showAfterFix = wp.status === "rework" || photosByPhase.after_fix.length > 0;
  const afterFixRounds = groupAfterFixByRound(photosByPhase.after_fix);
  // Spec 248 — defect photos: the current round's pairing state (banner strip
  // + capture slots) and the per-round history (read-only galleries). The
  // grouper is round-generic, so it serves defect rows too.
  const defectRounds = groupAfterFixByRound(photosByPhase.defect);
  const pairing = pairDefectPhotos(photosByPhase, wp.rework_round);
  const currentDefectPhotos = pairing.pairs.map((p) => p.defect);
  const defectPairSlots =
    wp.status === "rework" && pairing.pairs.length > 0
      ? pairing.pairs.map((p) => ({
          defectPhotoId: p.defect.id,
          defectUrl: signedUrls.get(p.defect.id) ?? null,
          answered: p.answers.length > 0,
          answerUrl: p.answers[0] ? (signedUrls.get(p.answers[0].id) ?? null) : null,
        }))
      : null;
  // Feedback a6037564: a PD wants to know who uploaded each photo. uploaded_by
  // is already on every photo_logs row; resolve the names once (admin read,
  // same pattern as photo-markups) and surface them in the lightbox.
  const uploaderNames = await fetchDisplayNames(
    Array.from(
      new Set([
        ...PHASES.flatMap(({ phase }) => photosByPhase[phase].map((p) => p.uploaded_by)),
        // Spec 248 — PHASES deliberately excludes defect (not an SA capture
        // phase); its uploaders still need names for the banner/gallery.
        ...photosByPhase.defect.map((p) => p.uploaded_by),
      ]),
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
    categoryId: r.catalog_items?.category_id ?? null,
    kind: r.catalog_items?.kind ?? null,
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

  // Spec 229 (ADR 0066 / S8): resolve THIS WP's work-category — its name for the
  // header badge, and (via the spec-226 reconcile + the S6 resolver) the material
  // categories its work buys (Relation R) for the scoped PR + เบิก pickers. The WP
  // binds to a project category (wp.category_id); an unbound / unmapped WP → empty
  // scope → the pickers fall back to the full catalog/on-hand (D8 show-all) and the
  // badge shows the nudge. project_categories is membership-readable, so this works
  // for every WP_DETAIL_ROLES viewer.
  let workCategoryName: string | null = null;
  // Spec 277 — the reconciled GLOBAL work-category code (W01–W09), for the badge's
  // letter·color·icon chip. NULL when the project-category isn't reconciled.
  let workCategoryCode: string | null = null;
  let scopedRelation: Awaited<ReturnType<typeof resolveScopedCategories>> = [];
  if (wp.category_id) {
    const { data: wpCategory } = await supabase
      .from("project_categories")
      .select("name, work_category_id, work_categories(code)")
      .eq("id", wp.category_id)
      .maybeSingle();
    workCategoryName = wpCategory?.name ?? null;
    if (wpCategory?.work_category_id) {
      const wcRel = wpCategory.work_categories;
      workCategoryCode = (Array.isArray(wcRel) ? wcRel[0]?.code : wcRel?.code) ?? null;
      scopedRelation = await resolveScopedCategories(supabase, wpCategory.work_category_id);
    }
  }
  const scopedCategoryIds = [...new Set(scopedRelation.map((r) => r.categoryId))];
  // The canonical∪secondary membership union (S4) both scoped pickers read.
  const itemMembershipMap = membershipsByItem(await loadCatalogItemMemberships(supabase));

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
          {/* Spec 248 — per-round defect evidence (the PM's photos), kept
              beside its round's หลังแก้ไข gallery for context. */}
          {defectRounds.map(({ round, photos }) => (
            <PhaseGallery
              key={`defect-${round}`}
              label={afterFixRoundHeading(
                PHOTO_PHASE_LABEL.defect,
                round,
                reworkSourceLabel(reworkSources.get(round)),
              )}
              photos={photos}
              signedUrls={signedUrls}
              uploaderNames={uploaderNames}
              note={reworkReasons.get(round) ?? null}
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
          defectPairs={defectPairSlots}
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
                scopedCategoryIds={scopedCategoryIds}
                membershipsByItem={itemMembershipMap}
              />
            </div>
          </details>
          {/* Spec 285 U3 — the self-purchase EXPENSE surface moved OUT of this
              "คำขอซื้อ" request tab into its own "ค่าใช้จ่ายหน้างาน" tab (below), so an
              expense (money already spent) is never confused with a ขอซื้อ request.
              This tab now holds only สร้างคำขอซื้อ + the request list. */}
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
    // Spec 285 U3 — the on-site EXPENSE (ซื้อเอง → บันทึกค่าใช้จ่าย) gets its own
    // clearly-labeled tab, separate from the คำขอซื้อ request tab above. Hidden for
    // the read-only viewer (the RPC gate excludes them anyway).
    ...(!readOnly
      ? [
          {
            key: "expenses",
            label: SITE_EXPENSE_TAB_LABEL,
            panel: (
              <SelfPurchaseSection
                projectId={wp.project_id}
                workPackageId={wp.id}
                catalogItems={catalogItems}
                categories={catalogCategoryList}
              />
            ),
          },
        ]
      : []),
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
              scopedRelation={scopedRelation}
              membershipsByItem={itemMembershipMap}
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
          <WpCategoryControl
            projectId={wp.project_id}
            workPackageId={wp.id}
            categoryId={wp.category_id}
            categories={projectCategories ?? []}
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
            {/* Spec 270 U4: a grouped งานย่อย shows its parent งาน as a
                breadcrumb (WP-05 › WP-05-03); legacy rows keep the bare code. */}
            {parentRow ? (
              <WpParentCrumb projectId={projectId} parent={parentRow} currentCode={wp.code} />
            ) : (
              <p className="text-meta text-ink-secondary font-mono">{wp.code}</p>
            )}
            {/* Spec 57: WP name never truncates — the nameplate. */}
            <h1 className={DETAIL_TITLE}>{wp.name}</h1>
            {/* Spec 229 (ADR 0066 / S8): the WP's หมวดงาน (work-category) — the same
                binding that scopes the PR + เบิก pickers below. */}
            <div className="mt-1.5">
              <WorkCategoryBadge name={workCategoryName} code={workCategoryCode} />
            </div>
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

      {/* Spec 278 U1: walk to the prev/next งาน without backing out to the list. */}
      <WpWalkBar projectId={projectId} walk={walk} from={from} />

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
                  contractors={pickerContractors}
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
            {/* Spec 248 — the PM's defect photos for THIS round: what to fix,
                zoomable. Every one needs a same-angle after-fix answer. */}
            {(() => {
              const loaded = currentDefectPhotos.flatMap((d) => {
                const url = signedUrls.get(d.id);
                return url ? [{ id: d.id, url }] : [];
              });
              if (loaded.length === 0) return null;
              const groupUrls = loaded.map((d) => d.url);
              return (
                <ul className="mt-2 flex [touch-action:pan-x_pinch-zoom] gap-2 overflow-x-auto pb-1">
                  {loaded.map((p, i) => (
                    <li
                      key={p.id}
                      className="border-edge bg-sunk relative h-20 w-20 shrink-0 overflow-hidden rounded border"
                    >
                      <ZoomablePhoto src={p.url} group={groupUrls} groupIndex={i} />
                    </li>
                  ))}
                </ul>
              );
            })()}
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
          (TRANSITIONABLE); the action's SQL guard no-ops on pending/complete.
          Spec 247: without completion evidence (after photo; in rework, a
          current-round after_fix photo) the button is disabled with a hint —
          the action re-enforces the same gate server-side. */}
      {!readOnly && (TRANSITIONABLE_FROM_STATUSES as readonly string[]).includes(wp.status) ? (
        <div className={`mx-auto ${PAGE_MAX_W} flex justify-end px-5 pt-5`}>
          <SubmitForApprovalControl
            projectId={wp.project_id}
            workPackageId={wp.id}
            // Spec 247 + 248 U4: floor AND pairing — null means submittable.
            disabledHint={submitGateReason(wp.status, photosByPhase, wp.rework_round)}
          />
        </div>
      ) : null}
      {wp.status === "complete" && !readOnly ? (
        <div className={`mx-auto ${PAGE_MAX_W} flex justify-end px-5 pt-5`}>
          {/* Spec 248: photo attach = filing roles (PM/PD/super); SA files text-only. */}
          <ReportDefectControl
            projectId={wp.project_id}
            workPackageId={wp.id}
            canAttachPhotos={isPlanner}
          />
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
