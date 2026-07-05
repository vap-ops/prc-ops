import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { getCurrentPhotosForWorkPackage, type PhotoLogRow } from "@/lib/photos/current-photos";
import { PHASES } from "@/lib/photos/phases";
import {
  groupAfterFixByRound,
  reworkReasonsFromAuditRows,
  reworkSourcesFromAuditRows,
  afterFixRoundHeading,
  reworkRoundTag,
} from "@/lib/photos/rework-round";
import { pairDefectPhotos } from "@/lib/photos/defect-pairing";
import { DefectFixPairs } from "@/components/features/photos/defect-fix-pairs";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { mintSignedUrls } from "@/lib/storage/signed-urls";
import { CATALOG_IMAGES_BUCKET } from "@/lib/storage/buckets";
import { loadCatalogCategories, categoryNameById } from "@/lib/catalog/categories";
import { getDecisionHistoryForWorkPackage } from "@/lib/approvals/latest-decision";
import {
  APPROVAL_DECISION_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  PHOTO_PHASE_LABEL,
  reworkSourceLabel,
  formatThaiDateTime,
} from "@/lib/i18n/labels";
import { CARD, DETAIL_TITLE, SECTION_HEADING } from "@/lib/ui/classes";
import { PhaseProgressBar } from "@/components/features/work-packages/phase-progress-bar";
import { approvalDecisionPillClasses, workPackageStatusPillClasses } from "@/lib/status-colors";
import { approvalDecisionIcon, workPackageStatusIcon } from "@/lib/status-icons";
import { PhaseGallery } from "@/components/features/photos/phase-gallery";
import { LaborLogZone } from "@/components/features/labor/labor-log-zone";
import { fetchLaborZoneData } from "@/lib/labor/fetch-zone-data";
import { createClient as createAdminClient } from "@/lib/db/admin";
import {
  aggregateLaborCost,
  currentLaborPairKeys,
  findOverAllocatedDays,
  type CostInputRow,
  type OverAllocatedDay,
} from "@/lib/labor/cost";
import { computeLaborVariance } from "@/lib/labor/variance";
import { laborBudgetSummary } from "@/lib/labor/budget";
import { bangkokDateOf } from "@/lib/dates";
import { LaborCostView } from "@/components/features/labor/labor-cost-view";
import { LaborBudgetCard } from "@/components/features/labor/labor-budget-card";
import { AttentionCard } from "@/components/features/common/attention-card";
import { RecordDecisionForm } from "./record-decision-form";
import { HoldToggle } from "./hold-toggle";
import {
  PurchaseRequestForm,
  type PurchaseRequestCatalogItem,
} from "@/components/features/purchasing/purchase-request-form";

interface PageProps {
  params: Promise<{ workPackageId: string }>;
}

export const metadata = { title: "ตรวจรายการงาน" };

export default async function WorkPackageReviewScreen({ params }: PageProps) {
  const { workPackageId } = await params;
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createClient();

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id, rework_round")
    .eq("id", workPackageId)
    .maybeSingle();

  if (!wp) {
    notFound();
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", wp.project_id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  // Spec 179/180: the active catalog master feeds the คำขอซื้อ item picker
  // (project-agnostic reference data; readable by any authenticated user), with
  // signed thumbnail URLs (private bucket → service-role signed URLs).
  // Spec 221 cleanup: read category_id (the managed FK) + the managed category
  // name, not the vestigial item_category enum.
  const { data: catalogRows } = await supabase
    .from("catalog_items")
    .select("id, category_id, base_item, spec_attrs, unit, image_path, product_code")
    .eq("is_active", true)
    .order("base_item", { ascending: true });
  const catalogCategories = await loadCatalogCategories(supabase);
  const categoryName = categoryNameById(catalogCategories);
  const catalogCategoryList = catalogCategories.map((c) => ({ id: c.id, name: c.name }));
  const catalogThumbs = await mintSignedUrls(
    CATALOG_IMAGES_BUCKET,
    (catalogRows ?? []).map((r) => ({ id: r.id, storage_path: r.image_path })),
  );
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

  const photosByPhase = await getCurrentPhotosForWorkPackage(supabase, wp.id);
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
    ...photosByPhase.after_fix,
    // Spec 248 — defect photos render in the pairs section below.
    ...photosByPhase.defect,
  ];
  const signedUrls = await mintSignedUrlsForPhotos(allPhotos);

  // Spec 216: the หลังแก้ไข bucket surfaces only inside a rework cycle, grouped by
  // round, each labelled with the defect reason that opened it (one
  // wp_reopened_for_defect audit row per round; audit_log SELECT is using(true)).
  const showAfterFix = wp.status === "rework" || photosByPhase.after_fix.length > 0;
  const afterFixRounds = groupAfterFixByRound(photosByPhase.after_fix);
  // Spec 248 — the current round's defect→fix pairs (the reviewer verifies
  // "same angle" where they decide) + defect history per round.
  const defectRounds = groupAfterFixByRound(photosByPhase.defect);
  const pairing = pairDefectPhotos(photosByPhase, wp.rework_round);
  const pairVMs = pairing.pairs.map((p) => ({
    defectPhotoId: p.defect.id,
    defectUrl: signedUrls.get(p.defect.id) ?? null,
    answers: p.answers.map((a) => ({ id: a.id, url: signedUrls.get(a.id) ?? null })),
  }));
  const { data: reopenRows } = await supabase
    .from("audit_log")
    .select("payload")
    .eq("target_id", wp.id)
    .eq("payload->>event", "wp_reopened_for_defect")
    .order("created_at", { ascending: false });
  const reworkReasons = reworkReasonsFromAuditRows(reopenRows ?? []);
  const reworkSources = reworkSourcesFromAuditRows(reopenRows ?? []);

  // Decision history: newest first. RLS admits sa/pm/super to SELECT
  // approvals so the PM (and super_admin) can read every row for this
  // WP under their own session. Helper threads the Database type
  // through so a.decision is the enum union, not any.
  const approvalsRows = await getDecisionHistoryForWorkPackage(supabase, wp.id);

  // Spec 46: daily crew presence — PM sees the same presence-only zone
  // plus the self-log flags (costs live in P2's requireRole-gated view).
  const labor = await fetchLaborZoneData(supabase, wp.id, wp.project_id);

  // Spec 68: PM-only labor cost. day_rate_snapshot and wp_labor_costs carry
  // NO authenticated grant, so read via the admin client — the page is
  // already requireRole(pm/super), the same authorized escalation as the
  // decider-name read below. Money never reaches a field session.
  const admin = createAdminClient();
  const { data: costRowsRaw } = await admin
    .from("labor_logs")
    .select(
      "id, worker_id, work_date, day_fraction, day_rate_snapshot, pay_type_snapshot, worker_name_snapshot, self_logged, superseded_by",
    )
    .eq("work_package_id", wp.id);
  const costRows = (costRowsRaw ?? []) as CostInputRow[];
  const costSummary = aggregateLaborCost(costRows);

  const { data: frozenRow } = await admin
    .from("wp_labor_costs")
    .select("own_cost, dc_cost, computed_at, frozen_by")
    .eq("work_package_id", wp.id)
    .maybeSingle();

  // Spec 205: the PM/PD-set labor budget (a money cost ceiling). Zero-grant, so
  // read via the admin client like wp_labor_costs; compared against the live
  // labor total for the budget-vs-actual card.
  const { data: econRow } = await admin
    .from("wp_economics")
    .select("labor_budget")
    .eq("work_package_id", wp.id)
    .maybeSingle();
  const budgetSummary = laborBudgetSummary(econRow?.labor_budget ?? null, costSummary.total);

  // C5: over-allocation is cross-WP — fetch the workers+dates on THIS WP
  // across all WPs, flag >1.0/day, keep only the pairs that touch this WP.
  let overAllocated: OverAllocatedDay[] = [];
  const costWorkerIds = Array.from(new Set(costSummary.workers.map((w) => w.workerId)));
  if (costWorkerIds.length > 0 && costSummary.laborDays.length > 0) {
    const { data: crossRaw } = await admin
      .from("labor_logs")
      .select("id, worker_id, work_date, day_fraction, superseded_by")
      .in("worker_id", costWorkerIds)
      .in("work_date", costSummary.laborDays);
    const thisPairs = currentLaborPairKeys(costRows);
    overAllocated = findOverAllocatedDays(crossRaw ?? []).filter((o) =>
      thisPairs.has(`${o.workerId}|${o.workDate}`),
    );
  }

  // Close-out variance: photo-activity days vs labor days (Asia/Bangkok).
  // Spec 248: defect photos are the PM's INSPECTION evidence, not site work —
  // counting them would flag "มีรูปแต่ไม่ได้ลงทีมงาน" on inspection days.
  const photoDays = Array.from(
    new Set(
      allPhotos
        .filter((p) => p.phase !== "defect")
        .map((p) => bangkokDateOf(p.captured_at_client ?? p.created_at)),
    ),
  );
  const variance = computeLaborVariance(photoDays, costSummary.laborDays);

  // public.users SELECT is gated to "users read self" + super_admin
  // (ADR 0011), so the SSR client can't resolve other users' names. Resolve
  // deciders + the freeze actor via the admin client in one read — only
  // display names leave the module.
  const nameIds = Array.from(
    new Set([
      ...approvalsRows.map((r) => r.decided_by),
      ...(frozenRow?.frozen_by ? [frozenRow.frozen_by] : []),
      // Feedback a6037564: resolve photo uploaders too, for the gallery's
      // "ถ่ายโดย <name>" attribution (one admin read covers all names).
      ...allPhotos.map((p) => p.uploaded_by),
    ]),
  );
  const displayNames = await fetchDisplayNames(nameIds, "[pm/work-packages]");

  const frozenSnapshot = frozenRow
    ? {
        ownCost: frozenRow.own_cost,
        dcCost: frozenRow.dc_cost,
        computedAt: frozenRow.computed_at,
        frozenByName: displayNames.get(frozenRow.frozen_by) ?? "ไม่ทราบชื่อ",
      }
    : null;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      {/* Spec 54 header (operator mockup) via the spec-63 shell; the
          progress band below scrolls. */}
      <DetailHeader backHref="/review" backLabel="กลับไปรายการรอตรวจ">
        <p className="text-ink-secondary truncate text-xs">
          <span className="font-mono">{project.code}</span>
          <span className="mx-1">·</span>
          {project.name}
        </p>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ink-secondary font-mono text-xs">{wp.code}</p>
            {/* Spec 57: WP name never truncates — full wrap. */}
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
        {/* Spec 52: PM-and-up hold toggle — renders nothing on
            pending_approval/complete. Spec 136: create moved off this header
            into an inline form in the body (no more cross-tab jump). */}
        <div className="flex items-center justify-end gap-3">
          <HoldToggle workPackageId={wp.id} status={wp.status} />
        </div>
      </DetailHeader>

      <div className="border-edge bg-card border-b px-5 py-3">
        <div className={`mx-auto ${PAGE_MAX_W}`}>
          <PhaseProgressBar
            counts={{
              before: photosByPhase.before.length,
              during: photosByPhase.during.length,
              after: photosByPhase.after.length,
              after_fix: photosByPhase.after_fix.length,
              defect: photosByPhase.defect.length,
            }}
          />
        </div>
      </div>

      <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-8 px-5 py-6`}>
        {/* Spec 136: raise a purchase request inline (was a cross-tab jump to
            /requests?wp=). PM/super self-approve via "สร้างและอนุมัติ". */}
        <details className={CARD}>
          <summary className="text-body text-ink cursor-pointer font-semibold">
            สร้างคำขอซื้อ
          </summary>
          <div className="mt-3">
            <PurchaseRequestForm
              workPackage={{ id: wp.id, code: wp.code, name: wp.name }}
              projectId={wp.project_id}
              userId={ctx.id}
              canSelfApprove
              catalogItems={catalogItems}
              categories={catalogCategoryList}
            />
          </div>
        </details>
        <section>
          <h2 className={SECTION_HEADING}>รูปถ่าย</h2>
          <div className="flex flex-col gap-5">
            {/* Spec 248 — the current round's pairs lead the section: the
                decision is "did each defect get its same-angle fix?" */}
            <DefectFixPairs
              heading={`จุดบกพร่อง → หลังแก้ไข (${reworkRoundTag(wp.rework_round)})`}
              pairs={pairVMs}
            />
            {PHASES.filter(({ phase }) => phase !== "after_fix").map(({ phase, label }) => (
              <PhaseGallery
                key={phase}
                label={label}
                photos={photosByPhase[phase]}
                signedUrls={signedUrls}
                uploaderNames={displayNames}
              />
            ))}
            {/* Spec 248 — PRIOR rounds' defect evidence (history context).
                The CURRENT round shows as pairs above — a second gallery of
                the same photos would double-render it (review finding). */}
            {defectRounds
              .filter(({ round }) => round !== wp.rework_round)
              .map(({ round, photos }) => (
                <PhaseGallery
                  key={`defect-${round}`}
                  label={afterFixRoundHeading(
                    PHOTO_PHASE_LABEL.defect,
                    round,
                    reworkSourceLabel(reworkSources.get(round)),
                  )}
                  photos={photos}
                  signedUrls={signedUrls}
                  uploaderNames={displayNames}
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
                    uploaderNames={displayNames}
                    note={reworkReasons.get(round) ?? null}
                  />
                ))
              : null}
          </div>
        </section>

        <section>
          <h2 className={SECTION_HEADING}>บันทึกทีมงานรายวัน</h2>
          <LaborLogZone
            workPackageId={wp.id}
            revalidate={`/review/work-packages/${workPackageId}`}
            roster={labor.roster}
            rows={labor.rows}
            projectWorkerIds={labor.projectWorkerIds}
            showFlags
            locked={wp.status === "complete"}
          />
        </section>

        {/* Spec 68 + 205: PM-only labor money. The labor budget card always
            renders here (the PM/PD can set a cost ceiling before any labor); the
            variance flag and the cost view self-gate to actual content
            (LaborCostView returns null with no cost/freeze). The SA page never
            shows money — this section lives only on the PM surface. */}
        <section>
          <h2 className={SECTION_HEADING}>ค่าแรง</h2>
          <div className="flex flex-col gap-4">
            <LaborBudgetCard
              summary={budgetSummary}
              workPackageId={wp.id}
              revalidate={`/review/work-packages/${workPackageId}`}
            />
            {variance.surfaces ? (
              <AttentionCard tone="amber" title="ภาพถ่ายกับวันลงทีมงานไม่ตรงกัน">
                <p className="text-ink-secondary text-xs">
                  {variance.photoOnlyDays.length > 0
                    ? `มีรูปแต่ไม่ได้ลงทีมงาน ${variance.photoOnlyDays.length} วัน`
                    : null}
                  {variance.photoOnlyDays.length > 0 && variance.laborOnlyDays.length > 0
                    ? " · "
                    : null}
                  {variance.laborOnlyDays.length > 0
                    ? `ลงทีมงานแต่ไม่มีรูป ${variance.laborOnlyDays.length} วัน`
                    : null}
                </p>
              </AttentionCard>
            ) : null}
            <LaborCostView
              summary={costSummary}
              frozen={frozenSnapshot}
              overAllocated={overAllocated}
              workPackageId={wp.id}
              revalidate={`/review/work-packages/${workPackageId}`}
            />
          </div>
        </section>

        <section>
          <h2 className={SECTION_HEADING}>ประวัติการตรวจ</h2>
          {approvalsRows.length === 0 ? (
            <EmptyNotice className="text-ink-secondary">ยังไม่มีการตรวจ</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2">
              {approvalsRows.map((a) => (
                <li key={a.id} className={CARD}>
                  <div className="flex items-center justify-between gap-3">
                    <StatusPill
                      pillClasses={approvalDecisionPillClasses(a.decision)}
                      icon={approvalDecisionIcon(a.decision)}
                    >
                      {APPROVAL_DECISION_LABEL[a.decision]}
                    </StatusPill>
                    <span className="text-ink-secondary text-xs">
                      {formatThaiDateTime(a.decided_at)}
                    </span>
                  </div>
                  <p className="text-ink-secondary mt-1 text-xs">
                    {displayNames.get(a.decided_by) ?? "ไม่ทราบชื่อผู้ตรวจ"}
                  </p>
                  {a.comment && (
                    <p className="text-ink mt-2 text-sm whitespace-pre-wrap">{a.comment}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className={SECTION_HEADING}>บันทึกผลการตรวจ</h2>
          {wp.status === "pending_approval" ? (
            <RecordDecisionForm workPackageId={wp.id} />
          ) : (
            <EmptyNotice className="text-ink-secondary">
              รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ
            </EmptyNotice>
          )}
        </section>
      </div>
    </PageShell>
  );
}
