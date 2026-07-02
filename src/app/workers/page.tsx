import { PageShell } from "@/components/features/chrome/page-shell";
// Spec 46 P1 — /workers: roster management. The ONE surface where day
// rates render: the page is requireRole-gated and the rates are fetched
// with the service-role client (the column has no authenticated grant —
// C3). Nothing here flows to a field role.
// Spec 172 Phase C / ADR 0062: procurement joins PM/super here — it owns DC
// onboarding (incl. the pay rate). The gate widens to WORKER_ROSTER_ROLES; the
// admin-client day_rate read stays authorized by that same gate.

import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import {
  WorkerRosterManager,
  type ManagedWorker,
} from "@/components/features/labor/worker-roster-manager";

export const metadata = { title: "ทีมงาน" };

export default async function WorkersPage() {
  const ctx = await requireRole(WORKER_ROSTER_ROLES);

  // Admin client: this page needs day_rate, which authenticated cannot
  // read by design. The requireRole gate above is what authorizes it.
  const admin = createAdminSupabase();
  const supabase = await createServerSupabase();

  // Perf debt rank 4 (architecture audit 2026-06): the three roster reads are
  // independent, so they ride ONE Promise.all (the spec 147 U1 pattern). Same
  // queries/columns/results — only the scheduling changes.
  const [{ data: workerRows }, { data: contractorRows }, { data: projectRows }] = await Promise.all(
    [
      admin
        .from("workers")
        .select(
          "id, name, worker_type, contractor_id, day_rate, active, note, dc_arrangement, user_id, project_id",
        )
        .order("name", { ascending: true }),
      // Spec 89: status + category let WorkerRosterManager hide blacklisted/non-DC
      // crews from the new-DC-worker picker while still resolving existing names.
      supabase
        .from("contractors")
        .select("id, name, status, contractor_category")
        .order("name", { ascending: true }),
      // Spec 200: the projects the assigner can put a worker on. RLS-scoped (the
      // assign gate is PM/super/director/procurement, the same audience as this page);
      // procurement sees all, PM sees members, super/director all.
      supabase.from("projects").select("id, code, name").order("code", { ascending: true }),
    ],
  );

  // ADR 0062 U4a: derive portalBound from user_id (the LINE binding); user_id
  // itself stays server-side — only the boolean reaches the client roster.
  const workers: ManagedWorker[] = (workerRows ?? []).map(({ user_id, ...w }) => ({
    ...w,
    portalBound: user_id !== null,
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">รายชื่อทีมงานและค่าแรง</h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <WorkerRosterManager
          workers={workers}
          contractors={contractorRows ?? []}
          projects={projectRows ?? []}
        />
      </div>
    </PageShell>
  );
}
