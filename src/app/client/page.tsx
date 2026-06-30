import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { loadClientView } from "@/lib/client-portal/load-client-view";
import { ClientProgressView } from "@/components/features/client-portal/client-progress-view";

export const metadata = { title: "ความคืบหน้าโครงการ" };

// Spec 233 / ADR 0067 U4 — the client's read-only progress home. requireRole
// admits only the `client` role (a non-client is routed home via roleHome).
// loadClientView returns null when there is no live access (expired/revoked,
// resolved by the RLS read arms) → the calm access-ended notice. Everything
// renders from the RLS-scoped reader: no money, no notes, no edit controls.
export default async function ClientPortalPage() {
  await requireRole(["client"]);
  const supabase = await createClient();
  const view = await loadClientView(supabase);
  if (!view) redirect("/client/access-ended");
  return <ClientProgressView view={view} />;
}
