import { PageShell } from "@/components/features/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { CARD, DETAIL_TITLE } from "@/lib/ui/classes";
import { notFound } from "next/navigation";
import { Camera, FileText, ShoppingCart, Users } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { projectHref, workPackageHref } from "@/lib/nav/project-paths";
import { createClient } from "@/lib/db/server";
import { getCurrentPhotosForWorkPackage, type PhotoLogRow } from "@/lib/photos/current-photos";
import { latestCreatedAt, PHASES } from "@/lib/photos/phases";
import { derivePhaseProgress } from "@/lib/photos/phase-progress";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { StatusPill } from "@/components/features/status-pill";
import { DetailHeader } from "@/components/features/detail-header";
import { PurchaseRequestCard } from "@/components/features/purchase-request-card";
import {
  APPROVAL_DECISION_LABEL,
  WORK_PACKAGE_STATUS_LABEL,
  formatThaiDateTime,
  formatThaiTime,
} from "@/lib/i18n/labels";
import { AttentionCard } from "@/components/features/attention-card";
import { CountChip } from "@/components/features/count-chip";
import { PhaseProgressBar } from "@/components/features/phase-progress-bar";
import {
  approvalDecisionPillClasses,
  workPackageStatusPillClasses,
  type PurchaseRequestPriority,
  type PurchaseRequestStatus,
} from "@/lib/status-colors";
import { fetchDisplayNames } from "@/lib/users/display-names";
import { WpAssignmentPanel } from "@/components/features/wp-assignment-panel";
import { WpPriorityControl } from "@/components/features/wp-priority-control";
import { WorkPackageNotes } from "@/components/features/work-package-notes";
import { PurchaseRequestForm } from "@/components/features/purchase-request-form";
import { SitePurchaseForm } from "@/components/features/site-purchase-form";
import { LaborLogZone } from "@/components/features/labor-log-zone";
import { fetchLaborZoneData } from "@/lib/labor/fetch-zone-data";
import { PhotoCaptureZone } from "./phase-uploader";

interface PageProps {
  params: Promise<{ projectId: string; workPackageId: string }>;
}

export const metadata = { title: "รูปถ่ายงาน" };

export default async function WorkPackagePhotoScreen({ params }: PageProps) {
  const { projectId, workPackageId } = await params;
  const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id, description, contractor_id, notes, priority")
    .eq("id", workPackageId)
    .maybeSingle();

  if (!wp || wp.project_id !== projectId) {
    notFound();
  }

  const { data: contractorRows } = await supabase
    .from("contractors")
    .select("id, name, phone, status")
    .order("name", { ascending: true });
  const contractors = contractorRows ?? [];
  const assignedContractor = wp.contractor_id
    ? (contractors.find((c) => c.id === wp.contractor_id) ?? null)
    : null;
  const pickerContractors = contractors
    .filter((c) => c.status !== "blacklisted" || c.id === wp.contractor_id)
    .map(({ id, name, phone }) => ({ id, name, phone }));

  const { data: approvalRows } = await supabase
    .from("approvals")
    .select("id, decision, comment, decided_by, decided_at")
    .eq("work_package_id", wp.id)
    .order("decided_at", { ascending: false });
  const approvals = approvalRows ?? [];
  const latestDecision = approvals[0] ?? null;
  const attention =
    latestDecision &&
    (latestDecision.decision === "needs_revision" || latestDecision.decision === "rejected")
      ? latestDecision
      : null;

  const isAssigner = true;

  const { data: wpRequests } = await supabase
    .from("purchase_requests")
    .select(
      "id, pr_number, item_description, quantity, unit, status, priority, requested_at, requested_by, requested_by_email, needed_by, decided_at, purchased_at, shipped_at, delivered_at, eta",
    )
    .eq("work_package_id", wp.id)
    .order("requested_at", { ascending: false });

  const nameIds = Array.from(
    new Set(
      [
        ...approvals.map((a) => a.decided_by),
        ...(wpRequests ?? []).map((r) => r.requested_by),
      ].filter((id): id is string => typeof id === "string"),
    ),
  );
  const displayNames = await fetchDisplayNames(nameIds, "[wp-detail]");

  const requestedCount = (wpRequests ?? []).filter((r) => r.status === "requested").length;

  const labor = await fetchLaborZoneData(supabase, wp.id);

  const photosByPhase = await getCurrentPhotosForWorkPackage(supabase, wp.id);
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
  ];
  const signedUrls = await mintSignedUrlsForPhotos(allPhotos);

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

  return (
    <PageShell>
      {/* Field-First: the tab bar gives way to the thumb-anchored capture
          bar on this detail screen; the back chip handles return nav. */}
      <DetailHeader backHref={projectHref(projectId)} backLabel="กลับไปรายการงาน">
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
        {assignedContractor ? (
          <>
            <p className="text-meta text-ink-secondary">
              ผู้รับเหมา <span className="text-ink font-semibold">{assignedContractor.name}</span>
              {assignedContractor.phone ? (
                <>
                  <span className="text-ink-muted mx-1">·</span>
                  <a href={`tel:${assignedContractor.phone}`} className="text-action font-semibold">
                    {assignedContractor.phone}
                  </a>
                </>
              ) : null}
            </p>
            {isAssigner ? (
              <WpAssignmentPanel
                projectId={wp.project_id}
                workPackageId={wp.id}
                contractors={pickerContractors}
                contractorId={wp.contractor_id}
              />
            ) : null}
          </>
        ) : null}
      </DetailHeader>

      <div className="border-edge bg-card border-b px-5 py-3">
        <div className={`mx-auto ${PAGE_MAX_W}`}>
          <PhaseProgressBar counts={phaseCounts} />
        </div>
      </div>

      {/* PM/super: manual priority — the worklist ด่วน tag + ต้องทำ sort. */}
      {ctx.role === "project_manager" || ctx.role === "super_admin" ? (
        <div className="border-edge bg-card border-b px-5 py-3">
          <div className={`mx-auto ${PAGE_MAX_W}`}>
            <WpPriorityControl
              projectId={wp.project_id}
              workPackageId={wp.id}
              priority={wp.priority}
            />
          </div>
        </div>
      ) : null}

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

      {/* HERO — capture is the page's primary job. */}
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className="border-ink text-section text-ink mb-3 flex items-center gap-2 border-b-2 pb-1 font-bold">
          <Camera aria-hidden className="text-action size-5" />
          รูปถ่ายงาน
        </h2>
        <PhotoCaptureZone
          projectId={wp.project_id}
          workPackageId={wp.id}
          userId={ctx.id}
          phases={phaseData}
          currentPhase={currentPhase}
        />
      </section>

      {/* Progressive disclosure: everything read-heavy folds below the
          hero. Order = the SA's frequency (purchases, then labor, then
          reference info). */}
      <div
        id="wp-requests"
        className={`mx-auto flex ${PAGE_MAX_W} scroll-mt-4 flex-col gap-4 px-5 pb-6`}
      >
        <h2 className="border-ink text-section text-ink flex items-center gap-2 border-b-2 pb-1 font-bold">
          <ShoppingCart aria-hidden className="text-action size-5" />
          คำขอซื้อ
        </h2>
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

        <h2 className="border-ink text-section text-ink mt-2 flex items-center gap-2 border-b-2 pb-1 font-bold">
          <Users aria-hidden className="text-action size-5" />
          บันทึกแรงงานรายวัน
        </h2>
        <LaborLogZone
          workPackageId={wp.id}
          revalidate={workPackageHref(projectId, workPackageId)}
          roster={labor.roster}
          rows={labor.rows}
          showFlags={ctx.role !== "site_admin"}
          locked={wp.status === "complete"}
        />

        <h2 className="border-ink text-section text-ink mt-2 flex items-center gap-2 border-b-2 pb-1 font-bold">
          <FileText aria-hidden className="text-action size-5" />
          ข้อมูลงาน
        </h2>
        <div className={CARD}>
          <WorkPackageNotes projectId={wp.project_id} workPackageId={wp.id} notes={wp.notes} />
        </div>
        {wp.description ? (
          <details className={CARD}>
            <summary className="text-body text-ink cursor-pointer font-semibold">
              รายละเอียดงาน
            </summary>
            <p className="text-body text-ink-secondary mt-2 whitespace-pre-wrap">
              {wp.description}
            </p>
          </details>
        ) : null}
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
      </div>
    </PageShell>
  );
}
