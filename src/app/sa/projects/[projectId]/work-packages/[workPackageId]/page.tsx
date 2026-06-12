import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, FileText, ShoppingCart, Users } from "lucide-react";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import {
  getCurrentPhotosForWorkPackage,
  type PhotoLogRow,
  type PhotoPhase,
} from "@/lib/photos/current-photos";
import { mintSignedUrlsForPhotos } from "@/lib/photos/signed-urls";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { StatusPill } from "@/components/features/status-pill";
import { RefreshButton } from "@/components/features/refresh-button";
import { PurchaseRequestCard } from "@/components/features/purchase-request-card";
import {
  APPROVAL_DECISION_LABEL,
  PHOTO_PHASE_LABEL,
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
import { PurchaseRequestForm } from "@/components/features/purchase-request-form";
import { LaborLogZone } from "@/components/features/labor-log-zone";
import { fetchLaborZoneData } from "@/lib/labor/fetch-zone-data";
import { PhaseUploader } from "./phase-uploader";

interface PageProps {
  params: Promise<{ projectId: string; workPackageId: string }>;
}

export const metadata = { title: "รูปถ่ายงาน" };

const PHASES: ReadonlyArray<{ phase: PhotoPhase; label: string }> = [
  // เตรียมงาน is the display label for the `before` enum value —
  // equipment and raw-material staging (spec 10). The DB enum is untouched.
  { phase: "before", label: PHOTO_PHASE_LABEL.before },
  { phase: "during", label: PHOTO_PHASE_LABEL.during },
  { phase: "after", label: PHOTO_PHASE_LABEL.after },
];

export default async function WorkPackagePhotoScreen({ params }: PageProps) {
  const { projectId, workPackageId } = await params;
  const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: wp } = await supabase
    .from("work_packages")
    .select("id, code, name, status, project_id, description, contractor_id")
    .eq("id", workPackageId)
    .maybeSingle();

  if (!wp || wp.project_id !== projectId) {
    notFound();
  }

  // Spec 31 / ADR 0033: WP owner = contractor entity (outsider crew).
  // One read serves both the header line and the assignment picker.
  const { data: contractorRows } = await supabase
    .from("contractors")
    .select("id, name, phone")
    .order("name", { ascending: true });
  const contractors = contractorRows ?? [];
  const assignedContractor = wp.contractor_id
    ? (contractors.find((c) => c.id === wp.contractor_id) ?? null)
    : null;

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

  // Spec-31 amendment: every role this page admits may manage
  // contractors (field staff included) — the RPC enforces server-side.
  const isAssigner = true;

  // Spec 25: this WP's purchase requests render inline — the operator's
  // "delivery status must show inside each WP, not having to go to the
  // request page." Same RLS-decided visibility as /requests. Spec 47
  // amendment: rows render through PurchaseRequestCard (tap opens
  // /requests/[id]), so the select carries the card's full prop set.
  const { data: wpRequests } = await supabase
    .from("purchase_requests")
    .select(
      "id, pr_number, item_description, quantity, unit, status, priority, requested_at, requested_by, requested_by_email, needed_by, decided_at, purchased_at, shipped_at, delivered_at, eta",
    )
    .eq("work_package_id", wp.id)
    .order("requested_at", { ascending: false });

  // One display-name lookup serves the approval history AND the request
  // cards' requester lines.
  const nameIds = Array.from(
    new Set(
      [
        ...approvals.map((a) => a.decided_by),
        ...(wpRequests ?? []).map((r) => r.requested_by),
      ].filter((id): id is string => typeof id === "string"),
    ),
  );
  const displayNames = await fetchDisplayNames(nameIds, "[wp-detail]");

  // Spec 54: the chip counts rows actually waiting on a PM decision
  // (mockup label คำขอซื้อรออนุมัติ) — replaces the old open-count line.
  const requestedCount = (wpRequests ?? []).filter((r) => r.status === "requested").length;

  // Spec 46: labor capture data (presence-only — the helper's explicit
  // column lists are the app-layer half of the money posture).
  const labor = await fetchLaborZoneData(supabase, wp.id);

  const photosByPhase = await getCurrentPhotosForWorkPackage(supabase, wp.id);
  const allPhotos: PhotoLogRow[] = [
    ...photosByPhase.before,
    ...photosByPhase.during,
    ...photosByPhase.after,
  ];
  const signedUrls = await mintSignedUrlsForPhotos(allPhotos);

  return (
    <main className="min-h-screen bg-zinc-50 pb-20 text-zinc-900 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      {/* Spec 54 header (operator mockup): back chip + refresh, code over
          a large bold name with the status pill, phase progress bar. */}
      <header className="border-b border-zinc-200 bg-white px-5 py-4">
        <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3`}>
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/sa/projects/${projectId}`}
              aria-label="กลับไปรายการงาน"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <ArrowLeft aria-hidden className="h-5 w-5" />
            </Link>
            {/* Spec 53: the PWA's only reload affordance. */}
            <RefreshButton variant="light" />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-zinc-600">{wp.code}</p>
              <h1 className="truncate text-2xl font-bold tracking-tight">{wp.name}</h1>
            </div>
            <StatusPill pillClasses={workPackageStatusPillClasses(wp.status)} className="mt-1">
              {WORK_PACKAGE_STATUS_LABEL[wp.status as keyof typeof WORK_PACKAGE_STATUS_LABEL] ??
                wp.status}
            </StatusPill>
          </div>
          {assignedContractor ? (
            <>
              <p className="text-xs text-zinc-600">
                ผู้รับเหมา{" "}
                <span className="font-medium text-zinc-900">{assignedContractor.name}</span>
                {assignedContractor.phone ? (
                  <>
                    <span className="mx-1 text-zinc-400">·</span>
                    <a href={`tel:${assignedContractor.phone}`} className="text-blue-700">
                      {assignedContractor.phone}
                    </a>
                  </>
                ) : null}
              </p>
              {/* Re-assignment stays reachable once assigned — the
                  attention card (below) only carries the UNASSIGNED case. */}
              {isAssigner ? (
                <WpAssignmentPanel
                  projectId={wp.project_id}
                  workPackageId={wp.id}
                  contractors={contractors}
                  contractorId={wp.contractor_id}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      <div className="border-b border-zinc-200 bg-white px-5 py-3">
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

      {/* Spec 54 attention stack: PM decision feedback, the unassigned-
          contractor card (mockup), and the pending-requests chip. */}
      {attention || !assignedContractor || requestedCount > 0 ? (
        <div className={`mx-auto flex ${PAGE_MAX_W} flex-col gap-3 px-5 pt-5`}>
          {attention ? (
            <AttentionCard
              tone={attention.decision === "rejected" ? "red" : "amber"}
              title={APPROVAL_DECISION_LABEL[attention.decision]}
            >
              <p className="text-xs text-zinc-600">
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

      {/* Spec 28 Part C: single column on phones (photos first — the
          SA's job); ≥md two columns — photos wide left, facts right.
          max width steps up to 4xl ONLY at md so phones keep the
          familiar 2xl measure. */}
      <div
        className={`mx-auto grid ${PAGE_MAX_W} grid-cols-1 gap-6 px-5 py-6 md:grid-cols-[1.6fr_1fr] md:items-start lg:gap-8`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          {/* Spec 30: zone headers — icon + bold title + rule line so the
              three content categories read as distinct at a glance. */}
          <h2 className="flex items-center gap-2 border-b-2 border-zinc-900 pb-1 text-base font-bold text-zinc-900">
            <Camera aria-hidden className="size-5 text-blue-700" />
            รูปถ่ายงาน
          </h2>
          {PHASES.map(({ phase, label }) => {
            const rows = photosByPhase[phase];
            // Spec 54: tile overlay = capture time (client clock when
            // known, else upload time); sub-line = latest upload time.
            const latest = rows.reduce<string | null>(
              (acc, p) => (acc === null || p.created_at > acc ? p.created_at : acc),
              null,
            );
            return (
              <PhaseUploader
                key={phase}
                projectId={wp.project_id}
                workPackageId={wp.id}
                userId={ctx.id}
                phase={phase}
                label={label}
                photos={rows.map((p) => ({
                  id: p.id,
                  url: signedUrls.get(p.id) ?? null,
                  timeLabel: formatThaiTime(p.captured_at_client ?? p.created_at),
                }))}
                lastUpdatedLabel={latest ? formatThaiTime(latest) : null}
              />
            );
          })}

          {/* Spec 46: daily crew presence. Field UI is presence-only —
              rates/costs never reach this page (C3 column grants). */}
          <h2 className="mt-2 flex items-center gap-2 border-b-2 border-zinc-900 pb-1 text-base font-bold text-zinc-900">
            <Users aria-hidden className="size-5 text-blue-700" />
            บันทึกแรงงานรายวัน
          </h2>
          <LaborLogZone
            projectId={wp.project_id}
            workPackageId={wp.id}
            revalidate={`/sa/projects/${projectId}/work-packages/${workPackageId}`}
            roster={labor.roster}
            rows={labor.rows}
            showFlags={ctx.role !== "site_admin"}
            locked={wp.status === "complete"}
          />
        </div>

        <div id="wp-requests" className="flex min-w-0 scroll-mt-4 flex-col gap-4">
          <h2 className="flex items-center gap-2 border-b-2 border-zinc-900 pb-1 text-base font-bold text-zinc-900">
            <ShoppingCart aria-hidden className="size-5 text-blue-700" />
            คำขอซื้อ
          </h2>
          {/* Spec 29: the create form lives HERE now — raising a request
              no longer teleports the user to the คำขอซื้อ tab
              (operator-reported disorientation; site map 2026-06-11).
              /requests?wp= pinned mode remains functional but no in-app
              link produces it. */}
          <details className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
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
          {(wpRequests ?? []).length > 0 ? (
            <section>
              {/* Spec 47 amendment (operator: "this is from WP detail
                  page"): the same slim card as /requests — tap opens the
                  order detail screen. WP line omitted; this zone IS the
                  WP context. */}
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
            </section>
          ) : null}
          <h2 className="mt-2 flex items-center gap-2 border-b-2 border-zinc-900 pb-1 text-base font-bold text-zinc-900">
            <FileText aria-hidden className="size-5 text-blue-700" />
            ข้อมูลงาน
          </h2>
          {wp.description ? (
            <details className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
                รายละเอียดงาน
              </summary>
              <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-700">{wp.description}</p>
            </details>
          ) : null}
          {approvals.length > 0 ? (
            <details className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
                ประวัติการตรวจ ({approvals.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {approvals.map((a) => (
                  <li key={a.id} className="border-t border-zinc-200 pt-2 first:border-t-0">
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill pillClasses={approvalDecisionPillClasses(a.decision)}>
                        {APPROVAL_DECISION_LABEL[a.decision]}
                      </StatusPill>
                      <span className="text-xs text-zinc-600">
                        {displayNames.get(a.decided_by) ?? "—"} · {formatThaiDateTime(a.decided_at)}
                      </span>
                    </div>
                    {a.comment ? (
                      <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-700">{a.comment}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </main>
  );
}
