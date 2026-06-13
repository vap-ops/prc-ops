import { PageShell } from "@/components/features/page-shell";
// Spec 46 P1 — /workers: roster management, pm/super only. The ONE
// surface where day rates render: the page is requireRole-gated and
// the rates are fetched with the service-role client (the column has
// no authenticated grant — C3). Nothing here flows to a field role.

import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { AppHeader } from "@/components/features/app-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import {
  WorkerRosterManager,
  type ManagedWorker,
} from "@/components/features/worker-roster-manager";

export const metadata = { title: "คนงาน" };

export default async function WorkersPage() {
  const ctx = await requireRole(PM_ROLES);

  // Admin client: this page needs day_rate, which authenticated cannot
  // read by design. The requireRole gate above is what authorizes it.
  const admin = createAdminSupabase();
  const { data: workerRows } = await admin
    .from("workers")
    .select("id, name, worker_type, contractor_id, day_rate, active, note")
    .order("name", { ascending: true });
  const workers: ManagedWorker[] = workerRows ?? [];

  const supabase = await createServerSupabase();
  // Spec 89: status + category let WorkerRosterManager hide blacklisted/non-DC
  // crews from the new-DC-worker picker while still resolving existing names.
  const { data: contractorRows } = await supabase
    .from("contractors")
    .select("id, name, status, contractor_category")
    .order("name", { ascending: true });

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader
        kicker="คนงาน"
        title="รายชื่อคนงานและค่าแรง"
        fullName={ctx.fullName}
        maxWidthClass={PAGE_MAX_W}
      />
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <WorkerRosterManager workers={workers} contractors={contractorRows ?? []} />
      </div>
    </PageShell>
  );
}
