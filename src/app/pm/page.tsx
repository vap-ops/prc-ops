import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { getLatestDecisionsForWorkPackages } from "@/lib/approvals/latest-decision";
import type { Database } from "@/lib/db/database.types";

type ApprovalDecision = Database["public"]["Enums"]["approval_decision"];

const DECISION_LABEL: Record<ApprovalDecision, string> = {
  approved: "Approved",
  rejected: "Rejected",
  needs_revision: "Revision requested",
};

// The label PMs read when scanning the queue: tells "first review" apart
// from "send-back coming back round". Approved WPs are 'complete' and
// drop off the queue, so 'approved' never appears here in practice — the
// map covers it for type safety.
function statusLabelForDecision(d: ApprovalDecision | null): string {
  return d ? DECISION_LABEL[d] : "Awaiting first review";
}

export default async function ProjectManagerLandingPage() {
  const ctx = await requireRole(["project_manager", "super_admin"]);
  const supabase = await createClient();

  // Two simple queries match the codebase pattern (see current-photos.ts):
  // fetch the pending WPs, then fetch their projects in one go. The
  // typed shape is clearer than relying on PostgREST's foreign-table
  // inflection.
  const { data: pendingWps, error: wpError } = await supabase
    .from("work_packages")
    .select("id, code, name, project_id")
    .eq("status", "pending_approval")
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
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-wider text-zinc-500 uppercase">Project manager</p>
            <h1 className="text-lg font-semibold tracking-tight">Hi, {ctx.fullName ?? "there"}.</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/profile"
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-100 focus:outline-none focus-visible:underline"
            >
              Profile
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <nav className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-4 text-xs">
          <span className="text-zinc-100">Review queue</span>
          <Link
            href="/pm/projects"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            Projects &amp; reports →
          </Link>
          <Link
            href="/pm/requests"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            Purchase requests →
          </Link>
          <Link
            href="/requests"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            Raise a request →
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-5 py-6">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Awaiting review</h2>

        {wpError ? (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            Couldn&apos;t load the review queue. Please try again.
          </p>
        ) : !pendingWps || pendingWps.length === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-400">
            Nothing awaiting review.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pendingWps.map((wp) => {
              const project = projectsById.get(wp.project_id);
              const latest = latestDecisions.get(wp.id) ?? null;
              const label = statusLabelForDecision(latest?.decision ?? null);
              return (
                <li key={wp.id}>
                  <Link
                    href={`/pm/work-packages/${wp.id}`}
                    className="flex min-h-16 items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  >
                    <div className="min-w-0 space-y-0.5">
                      {project && (
                        <p className="truncate text-xs text-zinc-500">
                          <span className="font-mono">{project.code}</span>
                          <span className="mx-1">·</span>
                          {project.name}
                        </p>
                      )}
                      <p className="truncate">
                        <span className="font-mono text-xs text-zinc-500">{wp.code}</span>
                        <span className="mx-2 text-zinc-700">·</span>
                        <span className="text-base font-medium text-zinc-100">{wp.name}</span>
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${decisionPillClasses(latest?.decision ?? null)}`}
                    >
                      {label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function decisionPillClasses(decision: ApprovalDecision | null): string {
  if (decision === "needs_revision") {
    return "border-amber-900/60 bg-amber-950/40 text-amber-200";
  }
  if (decision === "rejected") {
    return "border-red-900/60 bg-red-950/40 text-red-200";
  }
  // Approved doesn't appear here (status=complete drops off the queue);
  // null = awaiting first review.
  return "border-zinc-700 bg-zinc-800 text-zinc-300";
}
