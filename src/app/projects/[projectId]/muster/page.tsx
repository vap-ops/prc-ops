// Spec 306 U3 — the morning-talk muster cockpit. The SA forms teams behind their
// หัวหน้า and checks members in (and out) for the day. Lives on the project (where
// SAs actually work per telemetry), site-facing only. Reads on the RLS session
// client: the muster_* tables are select-scoped `can_see_project` (spec 306 U2),
// and the scan/open RPCs the cockpit calls self-gate on site_admin/super_admin +
// project membership — so a non-member reaching this URL simply sees an empty
// board and every action is refused server-side.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { MUSTER_LABEL } from "@/lib/i18n/labels";
import { loadMusterBoard } from "@/lib/muster/load-muster";
import { safeBackHref } from "@/lib/nav/back-href";
import { musterHref, projectHref } from "@/lib/nav/project-paths";
import { MusterCockpit } from "@/components/features/muster/muster-cockpit";

export const metadata = { title: MUSTER_LABEL };

interface PageProps {
  params: Promise<{ projectId: string }>;
  // Spec 334 follow-up: multi-parent page (project cockpit AND the /team hero) —
  // the back chip resolves ?from, else the project (the 313-U4 class).
  searchParams: Promise<{ from?: string }>;
}

export default async function MusterPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const { from } = await searchParams;
  await requireRole(["site_admin", "super_admin"]);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const date = bangkokTodayIso();
  const board = await loadMusterBoard(supabase, projectId, date);

  // The HT axis (spec 330/332): only crew leads may open a muster team as its
  // หัวหน้าทีม (operator rule 2026-07-21). RLS-scoped read; null leads drop out.
  const { data: crewLeads } = await supabase
    .from("crews")
    .select("lead_worker_id")
    .eq("project_id", projectId)
    .eq("active", true);
  const htWorkerIds = [
    ...new Set(
      (crewLeads ?? []).map((c) => c.lead_worker_id).filter((v): v is string => v !== null),
    ),
  ];

  return (
    <PageShell>
      <DetailHeader backHref={safeBackHref(from, projectHref(projectId))} backLabel="กลับ">
        <h1 className={DETAIL_TITLE}>{MUSTER_LABEL}</h1>
      </DetailHeader>
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-4 px-5 py-6`}>
        <p className="text-ink-secondary text-meta font-mono">{project.code}</p>
        <MusterCockpit
          projectId={projectId}
          date={date}
          revalidate={musterHref(projectId)}
          board={board}
          htWorkerIds={htWorkerIds}
        />
      </section>
    </PageShell>
  );
}
