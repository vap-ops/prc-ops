import { PageShell } from "@/components/features/chrome/page-shell";
// Spec 46 P1 — /workers: roster management. The ONE surface where day
// rates render: the page is requireRole-gated and the rates are fetched
// with the service-role client (the column has no authenticated grant —
// C3). Nothing here flows to a field role.
// Spec 172 Phase C / ADR 0062: procurement joins PM/super here — it owns ช่าง
// onboarding (incl. the pay rate). The gate widens to WORKER_ROSTER_ROLES; the
// admin-client day_rate read stays authorized by that same gate.

import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PM_ROLES, WORKER_ROSTER_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { safeBackHref } from "@/lib/nav/back-href";
import { WORKER_ROSTER_LABEL } from "@/lib/i18n/labels";
import {
  WorkerRosterManager,
  type ManagedWorker,
} from "@/components/features/labor/worker-roster-manager";

export const metadata = { title: WORKER_ROSTER_LABEL };

// Nav-coherence audit 2026-07: multi-parent (settings hub · /team · /procurement
// Resources tile) — the back chip resolves the ?from referrer, falling back to
// /settings for a direct load.
export default async function WorkersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
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
          // Spec 272 U1: + level (a readable category, ADR 0060 — not money).
          // DC edit matrix: + phone/tax_id/bank_* so the row edit sheet can prefill
          // and edit them (money/PII — authorized by the requireRole gate above).
          "id, name, pay_type, employment_type, contractor_id, day_rate, active, note, user_id, project_id, level, phone, tax_id, bank_name, bank_account_number, bank_account_name",
        )
        .order("name", { ascending: true }),
      // Spec 89: status + category let WorkerRosterManager hide blacklisted/non-ช่าง
      // crews from the new-ช่าง picker while still resolving existing names.
      supabase
        .from("contractors")
        .select("id, name, status, contractor_category")
        .order("name", { ascending: true }),
      // Spec 200: the projects the assigner can put a worker on. RLS-scoped (the
      // assign gate is PM/super/director/procurement, the same audience as this page);
      // procurement sees all, PM sees members, super/director all.
      // Spec 272 U2: + ht_worker_id (granted column) — feeds the หัวหน้าช่าง
      // badge + the assign block's replace-warning.
      supabase
        .from("projects")
        .select("id, code, name, ht_worker_id")
        .order("code", { ascending: true }),
    ],
  );

  // ADR 0062 U4a: derive portalBound from user_id (the LINE binding); user_id
  // itself stays server-side — only the boolean reaches the client roster.
  // DC edit matrix: withhold a bound worker's bank from the client entirely — once
  // bound, the ช่าง owns their bank via the portal request/approval flow, and the
  // edit sheet won't render it, so it must not ship in the props either.
  const workers: ManagedWorker[] = (workerRows ?? []).map(
    ({ user_id, bank_name, bank_account_number, bank_account_name, ...w }) => {
      const portalBound = user_id !== null;
      return {
        ...w,
        portalBound,
        bank_name: portalBound ? null : bank_name,
        bank_account_number: portalBound ? null : bank_account_number,
        bank_account_name: portalBound ? null : bank_account_name,
      };
    },
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/settings")} backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">
          {WORKER_ROSTER_LABEL}และค่าแรง
        </h1>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        {/* Spec 272 U3: the per-level sell-rate table already has its editor at
            /nova/dials (spec 161 U7) — link it instead of rebuilding. super_admin
            only, matching that page's own gate. */}
        {ctx.role === "super_admin" ? (
          <p className="mb-4">
            <Link href="/nova/dials" className="text-action text-sm font-medium hover:underline">
              ตารางราคาขายตามระดับ (Nova) →
            </Link>
          </p>
        ) : null}
        <WorkerRosterManager
          workers={workers}
          contractors={contractorRows ?? []}
          projects={projectRows ?? []}
          canGrade={ctx.role === "super_admin"}
          canAssignHt={PM_ROLES.includes(ctx.role)}
        />
      </div>
    </PageShell>
  );
}
