import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";

// PM project list. Each project links to the reports surface
// (/pm/projects/[id]/reports). Mirrors the SA project list shape so the
// two role-side flows feel like part of the same product, but gated to
// PM + super_admin (SA is intentionally excluded — SAs don't consume
// reports in v1, matching the reports table RLS).

const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

export default async function PmProjectsPage() {
  const ctx = await requireRole(["project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, code, name, status")
    .order("code", { ascending: true });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-5 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-wider text-zinc-500 uppercase">Project manager</p>
            <h1 className="text-lg font-semibold tracking-tight">Hi, {ctx.fullName ?? "there"}.</h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <nav className="border-b border-zinc-800/60 bg-zinc-900/30 px-5 py-2">
        <div className="mx-auto flex max-w-2xl items-center gap-4 text-xs">
          <Link
            href="/pm"
            className="text-zinc-500 transition-colors hover:text-zinc-200 focus:outline-none focus-visible:underline"
          >
            Review queue
          </Link>
          <span className="text-zinc-100">Projects &amp; reports</span>
        </div>
      </nav>

      <section className="mx-auto max-w-2xl px-5 py-6">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Projects</h2>

        {error ? (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            Couldn&apos;t load projects. Please try again.
          </p>
        ) : !projects || projects.length === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-400">
            No projects yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/pm/projects/${p.id}/reports`}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-zinc-500">{p.code}</p>
                    <p className="truncate text-base font-medium text-zinc-100">{p.name}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
                    {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
