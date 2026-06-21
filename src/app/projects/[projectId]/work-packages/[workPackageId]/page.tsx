import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, DETAIL_TITLE } from "@/lib/ui/classes";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { SITE_STAFF_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { projectHref, workPackageHref } from "@/lib/nav/project-paths";
import { createClient } from "@/lib/db/server";
import { latestCreatedAt, PHASES } from "@/lib/photos/phases";
import { derivePhaseProgress } from "@/lib/photos/phase-progress";
import { StatusPill } from "@/components/features/common/status-pill";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { WorkPackageInfoButton } from "@/components/features/work-packages/work-package-info-button";
import { PurchaseRequestCard } from "@/components/features/purchasing/purchase-request-card";
import {
  APPROVAL_DECISION_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
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
import { loadWorkPackageDetail } from "@/lib/work-packages/load-detail";
import { WpAssignmentPanel } from "@/components/features/work-packages/wp-assignment-panel";
import { WpPriorityControl } from "@/components/features/work-packages/wp-priority-control";
import { WpDeliverableControl } from "@/components/features/work-packages/wp-deliverable-control";
import { WpNameControl } from "@/components/features/work-packages/wp-name-control";
import { WpDeleteControl } from "@/components/features/work-packages/wp-delete-control";
import { WpSchedulePanel } from "@/components/features/work-packages/wp-schedule-panel";
import { WpDetailTabs, type WpDetailTab } from "@/components/features/work-packages/wp-detail-tabs";
import { WorkPackageNotes } from "@/components/features/work-packages/work-package-notes";
import { PurchaseRequestForm } from "@/components/features/purchasing/purchase-request-form";
import { SitePurchaseForm } from "@/components/features/purchasing/site-purchase-form";
import { LaborLogZone } from "@/components/features/labor/labor-log-zone";
import { PhotoCaptureZone } from "./phase-uploader";
import { ReportDefectControl } from "./report-defect-control";

interface PageProps {
  params: Promise<{ projectId: string; workPackageId: string }>;
}

export const metadata = { title: "รูปถ่ายงาน" };

export default async function WorkPackagePhotoScreen({ params }: PageProps) {
  const { projectId, workPackageId } = await params;
  const ctx = await requireRole(SITE_STAFF_ROLES);
  const supabase = await createClient();
  const isAssigner = true;
  const isPlanner = isManagerRole(ctx.role);

  // Spec 147 U1: one loader batches the WP-detail reads (was a serial
  // waterfall). Same queries/columns/results — only the scheduling changes.
  // Spec 155: the project's deliverables feed the planner-only bind control;
  // it depends only on projectId, so it rides alongside the loader (no waterfall).
  const [data, { data: projectDeliverables }] = await Promise.all([
    loadWorkPackageDetail(supabase, { workPackageId, projectId, isPlanner }),
    isPlanner
      ? supabase
          .from("deliverables")
          .select("id, code, name")
          .eq("project_id", projectId)
          .order("sort_order", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
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
  };
  const currentPhase = derivePhaseProgress(phaseCounts).currentPhase;
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
      })),
      lastUpdatedLabel: latest ? formatThaiTime(latest) : null,
    };
  });

  // Spec 167: the body folds into segmented tabs. Order = the SA's frequency
  // (capture first, then purchases, labor, reference info); the planner-only
  // จัดการ tab is appended last. Panels are server-rendered here and handed to
  // the client switcher as slots — one fetch, one render, focused view.
  const tabs: WpDetailTab[] = [
    {
      key: "photos",
      label: "รูปถ่าย",
      panel: (
        <PhotoCaptureZone
          projectId={wp.project_id}
          workPackageId={wp.id}
          userId={ctx.id}
          phases={phaseData}
          currentPhase={currentPhase}
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
              />
            </div>
          </details>
          <details className={CARD}>
            <summary className="text-body text-ink cursor-pointer font-semibold">
              บันทึกการซื้อหน้างาน
            </summary>
            <div className="mt-3">
              <SitePurchaseForm workPackageId={wp.id} projectId={wp.project_id} />
            </div>
          </details>
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
          showFlags={ctx.role !== "site_admin"}
          locked={wp.status === "complete"}
        />
      ),
    },
    {
      key: "info",
      label: "ข้อมูล",
      panel: (
        <>
          <div className={CARD}>
            <WorkPackageNotes projectId={wp.project_id} workPackageId={wp.id} notes={wp.notes} />
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
                      <StatusPill pillClasses={approvalDecisionPillClasses(a.decision)}>
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

  // PM/super/director management: rename · priority · งวดงาน bind · schedule +
  // dependencies · delete-empty. Tucked behind its own tab so it no longer
  // pushes the capture hero down for planners (spec 92/155/156/157).
  if (isPlanner) {
    tabs.push({
      key: "manage",
      label: "จัดการ",
      panel: (
        <>
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
        backHref={projectHref(projectId)}
        backLabel="กลับไปรายการงาน"
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
          <StatusPill pillClasses={workPackageStatusPillClasses(wp.status)} className="mt-1">
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
            {defectReason ? (
              <p className="whitespace-pre-wrap">{defectReason}</p>
            ) : (
              <p className="text-ink-secondary">แก้ไขแล้วถ่ายรูปใหม่เพื่อส่งตรวจอีกครั้ง</p>
            )}
          </AttentionCard>
        </div>
      ) : null}
      {wp.status === "complete" ? (
        <div className={`mx-auto ${PAGE_MAX_W} flex justify-end px-5 pt-5`}>
          <ReportDefectControl projectId={wp.project_id} workPackageId={wp.id} />
        </div>
      ) : null}

      {/* Spec 167: photos / purchases / labor / info (+ จัดการ for planners)
          fold into segmented tabs — each visit shows only the relevant
          section. The pending-requests chip (#wp-requests) opens คำขอซื้อ. */}
      <WpDetailTabs tabs={tabs} hashTabMap={{ "wp-requests": "purchases" }} />
    </PageShell>
  );
}
