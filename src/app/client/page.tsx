import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { loadClientProjects } from "@/lib/client-portal/load-client-projects";
import { loadClientView } from "@/lib/client-portal/load-client-view";
import { ClientProgressView } from "@/components/features/client-portal/client-progress-view";
import { ClientProjectList } from "@/components/features/client-portal/client-project-list";

export const metadata = { title: "ความคืบหน้าโครงการ" };

// Spec 234 / ADR 0067 — the client's read-only home. requireRole admits only the
// `client` role (a non-client is routed home via roleHome). It lists the
// client's live projects (the RLS arm returns exactly those): 0 → access-ended;
// 1 → opens straight into that project (spec-233 behaviour, unchanged); ≥2 → a
// project list that drills into /client/[projectId].
export default async function ClientPortalPage() {
  await requireRole(["client"]);
  const supabase = await createClient();
  const projects = await loadClientProjects(supabase);
  if (projects.length === 0) redirect("/client/access-ended");
  if (projects.length === 1) {
    const view = await loadClientView(supabase, projects[0]!.id);
    if (!view) redirect("/client/access-ended");
    return <ClientProgressView view={view} />;
  }
  return <ClientProjectList projects={projects} />;
}
