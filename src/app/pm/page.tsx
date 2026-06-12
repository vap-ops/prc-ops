import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { AppHeader } from "@/components/features/app-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { HubNav, PM_HUB_NAV } from "@/components/features/hub-nav";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { getLatestDecisionsForWorkPackages } from "@/lib/approvals/latest-decision";
import { APPROVAL_DECISION_LABEL, formatThaiDateTime } from "@/lib/i18n/labels";
import { approvalDecisionPillClasses, type ApprovalDecision } from "@/lib/status-colors";

export const metadata = { title: "รายการรอตรวจ" };

// The label PMs read when scanning the queue: tells "first review" apart
// from "send-back coming back round". Approved WPs are 'complete' and
// drop off the queue, so 'approved' never appears here in practice — the
// map covers it for type safety.
function statusLabelForDecision(d: ApprovalDecision | null): string {
  return d ? APPROVAL_DECISION_LABEL[d] : "รอตรวจครั้งแรก";
}

export default async function ProjectManagerLandingPage() {
  const ctx = await requireRole(["project_manager", "super_admin"]);
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
  const latestDecisions = await getLatestDecisionsForWorkPackages(
    supabase,
    (pendingWps ?? []).map((wp) => wp.id),
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="ผู้จัดการโครงการ" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />

      <HubNav maxWidthClass={PAGE_MAX_W} items={PM_HUB_NAV} currentHref="/pm" />

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className="mb-3 text-base font-semibold text-zinc-900">รอตรวจ</h2>

        {wpError ? (
          <ErrorNotice>โหลดรายการรอตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
        ) : !pendingWps || pendingWps.length === 0 ? (
          <EmptyNotice>ไม่มีรายการรอตรวจ</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
            {pendingWps.map((wp) => {
              const project = projectsById.get(wp.project_id);
              const latest = latestDecisions.get(wp.id) ?? null;
              const label = statusLabelForDecision(latest?.decision ?? null);
              return (
                <li key={wp.id}>
                  <Link
                    href={`/pm/work-packages/${wp.id}`}
                    className="flex min-h-16 items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                  >
                    <div className="min-w-0 space-y-0.5">
                      {project && (
                        <p className="truncate text-xs text-zinc-600">
                          <span className="font-mono">{project.code}</span>
                          <span className="mx-1">·</span>
                          {project.name}
                        </p>
                      )}
                      {/* Spec 57: clamp-2, never single-line truncate. */}
                      <p className="line-clamp-2 break-words">
                        <span className="font-mono text-xs text-zinc-600">{wp.code}</span>
                        <span className="mx-2 text-zinc-400">·</span>
                        <span className="text-base font-medium text-zinc-900">{wp.name}</span>
                      </p>
                      <p className="text-xs text-zinc-600">
                        เข้าคิวเมื่อ {formatThaiDateTime(wp.updated_at)}
                      </p>
                    </div>
                    <StatusPill pillClasses={approvalDecisionPillClasses(latest?.decision ?? null)}>
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
