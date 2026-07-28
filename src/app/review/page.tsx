import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import type { ReactNode } from "react";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, PM_HUB_NAV } from "@/components/features/chrome/hub-nav";
import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { SECTION_HEADING } from "@/lib/ui/classes";
import { getLatestDecisionsForWorkPackages } from "@/lib/approvals/latest-decision";
import { REVIEW_AWAITING_PHOTOS_LABEL, REVIEW_READY_AGAIN_LABEL } from "@/lib/approvals/resubmit";
import { daysWaiting, partitionReviewQueue } from "@/lib/approvals/review-queue";
import {
  APPROVAL_DECISION_LABEL,
  APPROVAL_REVISION_REASON_LABEL,
  formatThaiDateTime,
  REVIEW_ACTIONABLE_EMPTY,
  REVIEW_ACTIONABLE_ZONE_LABEL,
  REVIEW_AWAITING_SITE_NOTE,
  REVIEW_AWAITING_SITE_ZONE_LABEL,
  REVIEW_FIRST_PASS_LABEL,
  REVIEW_START_HERE_CTA,
  reviewStuckChip,
  waitingDaysChip,
} from "@/lib/i18n/labels";
import { approvalDecisionPillClasses, type ApprovalDecision } from "@/lib/status-colors";
import { approvalDecisionIcon } from "@/lib/status-icons";
import { ArrowRight, ChevronDown, Clock } from "lucide-react";

export const metadata = { title: "รายการรอตรวจ" };

// Subgroup headings sit UNDER the page's SECTION_HEADING h2, so they must not
// outweigh it: same size, same 600 weight, muted ink. (font-extrabold here made
// the h3s the heaviest text on the page — fresh-eyes catch.)
const ZONE_HEADING = "text-section text-ink-secondary font-semibold";

// Spec 371 U1 — the queue used to be one flat list of every pending_approval WP,
// which is also what the ภาพรวม badge counts. Live on 2026-07-28 that was 70 rows
// of which only 52 were the PM's move: the rest were needs_revision bounces the
// site admin has not answered yet, interleaved by queue age and marked only by a
// small pill. The page now splits on WHOSE MOVE IT IS — actionable work up top,
// the chase list collapsed below — with the rule itself in
// `@/lib/approvals/review-queue` so U2 can count from the same predicate.
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

  // Spec 371: the split itself is a pure rule, so the zones here and the count U2
  // will put on the badge read the same predicate.
  const queue = partitionReviewQueue({
    rows: pendingWps ?? [],
    decisionFor: (id) => {
      const d = latestDecisions.get(id);
      // `id` is optional on ApprovalRow (narrower readers omit it); without it the
      // answered-join is impossible, so treat the WP as never reviewed rather than
      // stranding it in a zone whose cure state we cannot know.
      if (!d?.id) return null;
      return {
        id: d.id,
        decision: d.decision,
        decided_at: d.decided_at,
        decided_by: d.decided_by,
        revision_reason: d.revision_reason ?? null,
      };
    },
    isAnswered: (decisionId) => answeredDecisionIds.has(decisionId),
  });

  const todayIso = bangkokTodayIso();
  const total = (pendingWps ?? []).length;
  const oldestActionableDays = queue.oldestActionableAt
    ? daysWaiting(queue.oldestActionableAt, todayIso)
    : null;

  type QueueRow = NonNullable<typeof pendingWps>[number];

  const projectLine = (wp: QueueRow) => {
    const project = projectsById.get(wp.project_id);
    if (!project) return null;
    return (
      <p className="text-ink-secondary truncate text-xs">
        <span className="font-mono">{project.code}</span>
        <span className="mx-1">·</span>
        {project.name}
      </p>
    );
  };

  // One row shape for both zones: identity on the left, the zone's own signal on
  // the right. `muted` styles the chase list as secondary without hiding it.
  const queueRow = (wp: QueueRow, right: ReactNode, muted = false) => (
    <li key={wp.id}>
      <Link
        href={`/review/work-packages/${wp.id}`}
        className={`rounded-card border-edge shadow-card focus-visible:ring-action flex min-h-16 items-start justify-between gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2 ${
          // A muted row is ALREADY bg-sunk, so the shared hover/active:bg-sunk would
          // be a no-op and the chase rows would give no press feedback at all.
          muted ? "bg-sunk hover:bg-card active:bg-card" : "bg-card hover:bg-sunk active:bg-sunk"
        }`}
      >
        <div className="min-w-0 space-y-0.5">
          {projectLine(wp)}
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
        <div className="flex shrink-0 flex-col items-end gap-1">{right}</div>
      </Link>
    </li>
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
        ) : total === 0 ? (
          <EmptyNotice>ไม่มีรายการรอตรวจ</EmptyNotice>
        ) : (
          <div className="flex flex-col gap-6">
            {/* ZONE A — the PM's move. */}
            {queue.actionableCount === 0 ? (
              <EmptyNotice>{REVIEW_ACTIONABLE_EMPTY}</EmptyNotice>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="border-attn-edge bg-attn-soft rounded-card flex flex-col items-start gap-3 border p-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-attn-ink text-3xl leading-none font-bold">
                      {queue.actionableCount}
                    </span>
                    <span className="text-attn-ink text-body font-semibold">
                      {REVIEW_ACTIONABLE_ZONE_LABEL}
                    </span>
                  </div>
                  {oldestActionableDays !== null ? (
                    <p className="text-attn-ink text-meta flex items-center gap-1">
                      <Clock aria-hidden className="size-3.5 shrink-0" />
                      เก่าสุด {waitingDaysChip(oldestActionableDays)}
                    </p>
                  ) : null}
                  {queue.startHere ? (
                    <Link
                      href={`/review/work-packages/${queue.startHere.id}`}
                      className="border-attn bg-card text-attn-ink hover:bg-sunk focus-visible:ring-action inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 font-semibold transition-colors focus:outline-none focus-visible:ring-2"
                    >
                      {REVIEW_START_HERE_CTA}
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  ) : null}
                </div>

                {queue.readyAgain.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <h3 className={ZONE_HEADING}>
                      {REVIEW_READY_AGAIN_LABEL} ({queue.readyAgain.length})
                    </h3>
                    <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
                      {queue.readyAgain.map((wp) =>
                        queueRow(
                          wp,
                          <StatusPill
                            pillClasses={approvalDecisionPillClasses("needs_revision")}
                            icon={approvalDecisionIcon("needs_revision")}
                          >
                            {REVIEW_READY_AGAIN_LABEL}
                          </StatusPill>,
                        ),
                      )}
                    </ul>
                  </section>
                ) : null}

                {queue.firstReview.length > 0 ? (
                  <section className="flex flex-col gap-2">
                    <h3 className={ZONE_HEADING}>
                      {REVIEW_FIRST_PASS_LABEL} ({queue.firstReview.length})
                    </h3>
                    <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
                      {queue.firstReview.map((wp) => {
                        // The age is the only thing that differs between these rows, so it
                        // is what the chip carries — a pill repeating the heading told the
                        // PM nothing 51 times over.
                        const days = daysWaiting(wp.updated_at, todayIso);
                        // …EXCEPT for the anomaly: `approved` closes a WP and `rejected`
                        // sends it to rework, so neither should be sitting here — but if one
                        // ever is, it must not be captioned "never reviewed". It keeps its
                        // real decision pill. Zero live rows today; this is the path where
                        // being wrong would be least noticed (retired reviewQueueLabel's
                        // fallback arm was the only thing covering it — fresh-eyes catch).
                        const decided = latestDecisions.get(wp.id)?.decision ?? null;
                        return queueRow(
                          wp,
                          decided !== null ? (
                            <StatusPill
                              pillClasses={approvalDecisionPillClasses(decided as ApprovalDecision)}
                              icon={approvalDecisionIcon(decided as ApprovalDecision)}
                            >
                              {APPROVAL_DECISION_LABEL[decided as ApprovalDecision] ?? decided}
                            </StatusPill>
                          ) : days === null ? null : (
                            <span className="text-ink-secondary text-meta whitespace-nowrap">
                              {waitingDaysChip(days)}
                            </span>
                          ),
                        );
                      })}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}

            {/* ZONE B — not the PM's move. Collapsed, never removed: this is where
                they come to chase the site. */}
            {queue.awaitingSite.length > 0 ? (
              // Open by default when zone A is empty: otherwise the whole page is one
              // thin collapsed bar and the PM has to guess there is anything behind it.
              <details
                className="border-edge rounded-card group overflow-hidden border"
                open={queue.actionableCount === 0}
              >
                <summary className="hover:bg-sunk focus-visible:ring-action flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 focus:outline-none focus-visible:ring-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <ChevronDown
                      aria-hidden
                      className="text-ink-muted size-4 shrink-0 transition-transform group-open:rotate-180"
                    />
                    <span className="text-ink-secondary truncate">
                      {REVIEW_AWAITING_SITE_ZONE_LABEL} ({queue.awaitingSite.length})
                    </span>
                  </span>
                  {/* The note claims an exclusion from a number above it — so it only
                      renders when that number is on screen. */}
                  {queue.actionableCount > 0 ? (
                    <span className="bg-sunk text-ink-secondary text-meta shrink-0 rounded-full px-2 py-0.5">
                      {REVIEW_AWAITING_SITE_NOTE}
                    </span>
                  ) : null}
                </summary>
                <ul className="flex flex-col gap-2 px-4 pt-1 pb-4 lg:grid lg:grid-cols-2 lg:gap-3">
                  {queue.awaitingSite.map(({ row, bouncedAt, reason }) => {
                    const days = daysWaiting(bouncedAt, todayIso);
                    return queueRow(
                      row,
                      <>
                        <span className="text-ink-secondary text-meta whitespace-nowrap">
                          {reason
                            ? APPROVAL_REVISION_REASON_LABEL[reason]
                            : REVIEW_AWAITING_PHOTOS_LABEL}
                        </span>
                        {days === null ? null : (
                          <span className="text-danger text-meta whitespace-nowrap">
                            {reviewStuckChip(days)}
                          </span>
                        )}
                      </>,
                      true,
                    );
                  })}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </section>
    </PageShell>
  );
}
