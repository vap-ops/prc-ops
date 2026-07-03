import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { loadClientWpDetail } from "@/lib/client-portal/load-client-wp-detail";
import { ClientWpDetailView } from "@/components/features/client-portal/client-wp-detail-view";

export const metadata = { title: "รายละเอียดงาน" };

interface PageProps {
  params: Promise<{ projectId: string; wpId: string }>;
}

// Client WP-detail drill (extends spec 233/234 U4). requireRole(['client']) is
// the boundary; loadClientWpDetail scopes to the project + WP and RLS still
// gates it — a wpId the client has no live access to, or one belonging to a
// different project, returns null → back to the project view.
export default async function ClientWorkPackageDetailPage({ params }: PageProps) {
  const { projectId, wpId } = await params;
  await requireRole(["client"]);
  const supabase = await createClient();
  const detail = await loadClientWpDetail(supabase, projectId, wpId);
  if (!detail) redirect(`/client/${projectId}`);
  return <ClientWpDetailView detail={detail} backHref={`/client/${projectId}`} />;
}
