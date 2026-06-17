import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { EmptyNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { getCurrentPhotosForWorkPackage, type PhotoLogRow } from "@/lib/photos/current-photos";
import { PHASES, latestCreatedAt } from "@/lib/photos/phases";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { getDecisionHistoryForWorkPackage } from "@/lib/approvals/latest-decision";
import {
  APPROVAL_DECISION_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  formatThaiDateTime,
  formatThaiTime,
} from "@/lib/i18n/labels";
import { CARD, DETAIL_TITLE, SECTION_HEADING } from "@/lib/ui/classes";
import { PhaseProgressBar } from "@/components/features/work-packages/phase-progress-bar";
import { approvalDecisionPillClasses, workPackageStatusPillClasses } from "@/lib/status-colors";
import { ZoomablePhoto } from "@/components/features/photos/photo-lightbox";
import { PhotoStrip, PHOTO_STRIP_TILE } from "@/components/features/photos/photo-strip";
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
import { bangkokDateOf } from "@/lib/dates";
import { LaborCostView } from "@/components/features/labor/labor-cost-view";
import { AttentionCard } from "@/components/features/common/attention-card";
import { RecordDecisionForm } from "./record-decision-form";
import { HoldToggle } from "./hold-toggle";
import { PurchaseRequestForm } from "@/components/features/purchasing/purchase-request-form";

interface PageProps {
  params: Promise<{ workPackageId: string }>;
}

export const metadata = { title: "ตรวจรายการงาน" };

export default async function WorkPackageReviewScreen({ params }: PageProps) {
  const { workPackageId } = await params;
  const ctx = await requireRole(["project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id")
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

  const photosByPhase = await getCurrentPhotosForWorkPackage(supabase, wp.id);
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
  ];
  const signedUrls = await mintSignedUrlsForPhotos(allPhotos);

  // Decision history: newest first. RLS admits sa/pm/super to SELECT
  // approvals so the PM (and super_admin) can read every row for this
  // WP under their own session. Helper threads the Database type
  // through so a.decision is the enum union, not any.
  const approvalsRows = await getDecisionHistoryForWorkPackage(supabase, wp.id);

  // Spec 46: daily crew presence — PM sees the same presence-only zone
  // plus the self-log flags (costs live in P2's requireRole-gated view).
  const labor = await fetchLaborZoneData(supabase, wp.id);

  // Spec 68: PM-only labor cost. day_rate_snapshot and wp_labor_costs carry
  // NO authenticated grant, so read via the admin client — the page is
  // already requireRole(pm/super), the same authorized escalation as the
  // decider-name read below. Money never reaches a field session.
  const admin = createAdminClient();
  const { data: costRowsRaw } = await admin
    .from("labor_logs")
    .select(
      "id, worker_id, work_date, day_fraction, day_rate_snapshot, worker_type_snapshot, worker_name_snapshot, self_logged, superseded_by",
    )
    .eq("work_package_id", wp.id);
  const costRows = (costRowsRaw ?? []) as CostInputRow[];
  const costSummary = aggregateLaborCost(costRows);

  const { data: frozenRow } = await admin
    .from("wp_labor_costs")
    .select("own_cost, dc_cost, computed_at, frozen_by")
    .eq("work_package_id", wp.id)
    .maybeSingle();

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
  const photoDays = Array.from(
    new Set(allPhotos.map((p) => bangkokDateOf(p.captured_at_client ?? p.created_at))),
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
          <StatusPill pillClasses={workPackageStatusPillClasses(wp.status)} className="mt-1">
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
            />
          </div>
        </details>
        <section>
          <h2 className={SECTION_HEADING}>รูปถ่าย</h2>
          <div className="flex flex-col gap-5">
            {PHASES.map(({ phase, label }) => (
              <PhaseGallery
                key={phase}
                label={label}
                photos={photosByPhase[phase]}
                signedUrls={signedUrls}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className={SECTION_HEADING}>บันทึกแรงงานรายวัน</h2>
          <LaborLogZone
            workPackageId={wp.id}
            revalidate={`/review/work-packages/${workPackageId}`}
            roster={labor.roster}
            rows={labor.rows}
            showFlags
            locked={wp.status === "complete"}
          />
        </section>

        {/* Spec 68: PM-only labor cost + close-out variance. Renders only
            when there is cost content or a variance to flag. The SA page
            never shows money — this section lives only on the PM surface. */}
        {costSummary.workers.length > 0 || frozenSnapshot || variance.surfaces ? (
          <section>
            <h2 className={SECTION_HEADING}>ค่าแรง</h2>
            <div className="flex flex-col gap-4">
              {variance.surfaces ? (
                <AttentionCard tone="amber" title="ภาพถ่ายกับวันลงแรงงานไม่ตรงกัน">
                  <p className="text-ink-secondary text-xs">
                    {variance.photoOnlyDays.length > 0
                      ? `มีรูปแต่ไม่ได้ลงแรงงาน ${variance.photoOnlyDays.length} วัน`
                      : null}
                    {variance.photoOnlyDays.length > 0 && variance.laborOnlyDays.length > 0
                      ? " · "
                      : null}
                    {variance.laborOnlyDays.length > 0
                      ? `ลงแรงงานแต่ไม่มีรูป ${variance.laborOnlyDays.length} วัน`
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
        ) : null}

        <section>
          <h2 className={SECTION_HEADING}>ประวัติการตรวจ</h2>
          {approvalsRows.length === 0 ? (
            <EmptyNotice className="text-ink-secondary">ยังไม่มีการตรวจ</EmptyNotice>
          ) : (
            <ul className="flex flex-col gap-2">
              {approvalsRows.map((a) => (
                <li key={a.id} className={CARD}>
                  <div className="flex items-center justify-between gap-3">
                    <StatusPill pillClasses={approvalDecisionPillClasses(a.decision)}>
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

interface PhaseGalleryProps {
  label: string;
  photos: ReadonlyArray<PhotoLogRow>;
  signedUrls: ReadonlyMap<string, string>;
}

// Spec 54 timeline row — the read-only sibling of the SA uploader's
// treatment: status disc + bold label + count, rail-indented body with
// the last-updated line and the filmstrip (no add tile on the PM side).
function PhaseGallery({ label, photos, signedUrls }: PhaseGalleryProps) {
  const hasPhotos = photos.length > 0;
  const latest = latestCreatedAt(photos);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-3">
        {hasPhotos ? (
          <span className="bg-done inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white">
            <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
          </span>
        ) : (
          <span
            aria-hidden
            className="border-edge-strong bg-card h-7 w-7 shrink-0 rounded-full border-2"
          />
        )}
        <h3 className="text-ink text-base font-bold">
          {label}
          {hasPhotos ? (
            /* Spec 49: the strip hides its tail — announce the total. */
            <span className="text-ink-secondary ml-1.5 text-sm font-normal">
              {photos.length} รูป
            </span>
          ) : null}
        </h3>
      </div>
      <div
        className={`ml-[13px] flex flex-col gap-2 border-l-2 pb-1 pl-5 ${
          hasPhotos ? "border-done" : "border-edge"
        }`}
      >
        <p className="text-ink-secondary text-sm">
          {latest ? `อัปเดตล่าสุด ${formatThaiTime(latest)}` : "ยังไม่มีรูป"}
        </p>
        {hasPhotos ? (
          /* Spec 49: filmstrip — page height stays constant per phase.
             Spec 50: the phase's loaded photos form one lightbox group. */
          <PhotoStrip>
            {(() => {
              const loaded = photos.flatMap((p) => {
                const u = signedUrls.get(p.id);
                return u ? [{ id: p.id, url: u }] : [];
              });
              const loadedUrls = loaded.map((l) => l.url);
              /* Spec 51: ids aligned with urls — markup follows navigation. */
              const loadedPhotoIds = loaded.map((l) => l.id);
              let loadedIndex = 0;
              return photos.map((p) => {
                const url = signedUrls.get(p.id);
                const groupIndex = url ? loadedIndex++ : 0;
                return (
                  <li key={p.id} className={PHOTO_STRIP_TILE}>
                    {url ? (
                      <ZoomablePhoto
                        src={url}
                        group={loadedUrls}
                        groupPhotoIds={loadedPhotoIds}
                        groupIndex={groupIndex}
                        photoId={p.id}
                      />
                    ) : (
                      <div className="text-ink-secondary flex h-full w-full items-center justify-center text-xs">
                        ไม่พร้อมแสดง
                      </div>
                    )}
                    {/* Spec 54: capture-time overlay (mockup tiles). */}
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-medium text-white">
                      {formatThaiTime(p.captured_at_client ?? p.created_at)}
                    </span>
                  </li>
                );
              });
            })()}
          </PhotoStrip>
        ) : null}
      </div>
    </div>
  );
}
