import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, PM_HUB_NAV } from "@/components/features/chrome/hub-nav";
import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { SECTION_HEADING } from "@/lib/ui/classes";
import { getLatestDecisionsForWorkPackages } from "@/lib/approvals/latest-decision";
import { reviewQueueLabel, reviewQueueRank } from "@/lib/approvals/resubmit";
import { APPROVAL_DECISION_LABEL, formatThaiDateTime } from "@/lib/i18n/labels";
import { approvalDecisionPillClasses, type ApprovalDecision } from "@/lib/status-colors";
import { approvalDecisionIcon } from "@/lib/status-icons";

export const metadata = { title: "รายการรอตรวจ" };

// The label PMs read when scanning the queue: tells "first review" apart
// from "send-back coming back round". Approved WPs are 'complete' and
// drop off the queue, so 'approved' never appears here in practice — the
// map covers it for type safety.
function statusLabelForDecision(d: string | null): string {
  return d ? (APPROVAL_DECISION_LABEL[d as ApprovalDecision] ?? d) : "รอตรวจครั้งแรก";
}

export default async function ProjectManagerLandingPage() {
  const ctx = await requireRole(PM_ROLES);
  const supabase = await createClient();

  // Two simple queries match the codebase pattern (see current-photos.ts):
  // fetch the pending WPs, then fetch their projects in one go. The
  // typed shape is clearer than relying on PostgREST's foreign-table
  // inflection.
  // Oldest-waiting first (spec 15 item C): the status flip to
  // pending_approval is the last app write to a queued WP, so
  // updated_at marks queue entry. Code is the deterministic tiebreak.
  const { data: pendingWps, error: wpError } = await supabase
    .from("work_packages")
    .select("id, code, name, project_id, updated_at")
    .eq("status", "pending_approval")
    .order("updated_at", { ascending: true })
    .order("code", { ascending: true });

  const projectIds = Array.from(new Set((pendingWps ?? []).map((wp) => wp.project_id)));
  const { data: projects } = await supabase
    .from("projects")
    .select("id, code, name")
    .in("id", projectIds);

  const projectsById = new Map((projects ?? []).map((p) => [p.id, p]));
  const pendingIds = (pendingWps ?? []).map((wp) => wp.id);
  // Spec 337 U2 — which bounces the SA has already answered. This is what makes
  // the SA-side clear safe: the item leaves their list and ARRIVES here, marked
  // พร้อมตรวจอีกครั้ง and sorted up, instead of resting on a mute-able push alone.
  const [latestDecisions, { data: resubmitRows }] = await Promise.all([
    getLatestDecisionsForWorkPackages(supabase, pendingIds),
    pendingIds.length
      ? supabase
          .from("audit_log")
          .select("payload")
          .eq("target_table", "work_packages")
          .in("target_id", pendingIds)
          .eq("payload->>event", "wp_evidence_resubmitted")
      : Promise.resolve({ data: null }),
  ]);
  const answeredDecisionIds = new Set(
    (resubmitRows ?? [])
      .map((r) => (r.payload as { answers_decision_id?: string } | null)?.answers_decision_id)
      .filter((id): id is string => typeof id === "string"),
  );
  const isAnswered = (wpId: string) => {
    const d = latestDecisions.get(wpId);
    return d?.id !== undefined && answeredDecisionIds.has(d.id);
  };
  // Stable: only lifts answered bounces above the rest; spec 15's oldest-first
  // ordering survives untouched inside each rank.
  const queue = [...(pendingWps ?? [])].sort(
    (a, b) =>
      reviewQueueRank(latestDecisions.get(a.id)?.decision ?? null, isAnswered(a.id)) -
      reviewQueueRank(latestDecisions.get(b.id)?.decision ?? null, isAnswered(b.id)),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="ผู้จัดการโครงการ" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />

      {/* Spec 183 U2: the queue is a sub-surface of ภาพรวม now — highlight the
          ภาพรวม strip item (currentHref=/dashboard), mirroring the bottom bar. */}
      <HubNav
        maxWidthClass={PAGE_MAX_W}
        items={PM_HUB_NAV}
        currentHref="/dashboard"
        role={ctx.role}
      />

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>รอตรวจ</h2>

        {wpError ? (
          <ErrorNotice>โหลดรายการรอตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
        ) : queue.length === 0 ? (
          <EmptyNotice>ไม่มีรายการรอตรวจ</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
            {queue.map((wp) => {
              const project = projectsById.get(wp.project_id);
              const latest = latestDecisions.get(wp.id) ?? null;
              const label = reviewQueueLabel(
                latest?.decision ?? null,
                isAnswered(wp.id),
                statusLabelForDecision,
              );
              return (
                <li key={wp.id}>
                  <Link
                    href={`/review/work-packages/${wp.id}`}
                    className="rounded-card border-edge bg-card shadow-card hover:bg-sunk focus-visible:ring-action active:bg-sunk flex min-h-16 items-start justify-between gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
                  >
                    <div className="min-w-0 space-y-0.5">
                      {project && (
                        <p className="text-ink-secondary truncate text-xs">
                          <span className="font-mono">{project.code}</span>
                          <span className="mx-1">·</span>
                          {project.name}
                        </p>
                      )}
                      {/* Spec 57: clamp-2, never single-line truncate. */}
                      <p className="line-clamp-2 break-words">
                        <span className="text-ink-secondary font-mono text-xs">{wp.code}</span>
                        <span className="text-ink-muted mx-2">·</span>
                        <span className="text-ink text-base font-medium">{wp.name}</span>
                      </p>
                      <p className="text-ink-secondary text-xs">
                        เข้าคิวเมื่อ {formatThaiDateTime(wp.updated_at)}
                      </p>
                    </div>
                    <StatusPill
                      pillClasses={approvalDecisionPillClasses(latest?.decision ?? null)}
                      icon={approvalDecisionIcon(latest?.decision ?? null)}
                    >
                      {label}
                    </StatusPill>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
