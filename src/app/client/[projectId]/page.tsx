import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { loadClientView } from "@/lib/client-portal/load-client-view";
import { ClientProgressView } from "@/components/features/client-portal/client-progress-view";

export const metadata = { title: "ความคืบหน้าโครงการ" };

interface PageProps {
  params: Promise<{ projectId: string }>;
}

// Spec 234 / ADR 0067 U2 — one project's progress, drilled in from the /client
// list. requireRole(['client']) is the boundary; loadClientView scopes to the
// project and RLS still gates it — a projectId the client has no live access to
// returns null → back to the list. A back chip returns to /client.
export default async function ClientProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  await requireRole(["client"]);
  const supabase = await createClient();
  const view = await loadClientView(supabase, projectId);
  if (!view) redirect("/client");
  return <ClientProgressView view={view} backHref="/client" />;
}
