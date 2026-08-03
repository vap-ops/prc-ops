import { PageShell } from "@/components/features/chrome/page-shell";
// Spec 46 P1 — /workers: roster management. Day rates render here and on the
// spec-374 attendance calendar (/workers/[id]/attendance) — both requireRole-
// gated on WORKER_ROSTER_ROLES, both fetching with the service-role client
// (the column has no authenticated grant — C3). Nothing flows to a field role.
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
  type LevelRates,
  type ManagedWorker,
  type TradeOption,
} from "@/components/features/labor/worker-roster-manager";
import { grossRate } from "@/lib/labor/gross-rate";
import { WORKER_LEVEL_ORDER } from "@/lib/nova/dials";
import type { WorkerTrade } from "@/lib/workers/trades";
import { isWorkCategoryTopCode } from "@/lib/work-categories/identity";

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
  const [
    { data: workerRows },
    { data: contractorRows },
    { data: projectRows },
    { data: tradeRows },
    { data: tradeCategoryRows },
    levelRatesRes,
    whtCfgRes,
  ] = await Promise.all([
    admin
      .from("workers")
      .select(
        // Spec 272 U1: + level (a readable category, ADR 0060 — not money).
        // Spec 369 U1: + cost_confirmed_at — the confirm door's ยืนยันแล้ว state.
        // DC edit matrix: + phone/tax_id/bank_* so the row edit sheet can prefill
        // and edit them (money/PII — authorized by the requireRole gate above).
        "id, name, pay_type, employment_type, contractor_id, day_rate, active, note, user_id, project_id, level, cost_confirmed_at, phone, tax_id, bank_name, bank_account_number, bank_account_name, gender",
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
    // Spec 332: each worker's trade tags (สายงาน) + the category identity to
    // render them. Read via the same admin client as the roster (RLS on
    // worker_trades is select-for-authenticated; the admin read is authorized
    // by the requireRole gate above and keeps the reads on one client).
    admin
      .from("worker_trades")
      .select("worker_id, work_category_id, is_primary, work_categories(code, name_th)"),
    // The 11 global work-categories (W01–W11) = the trade options the sheet
    // offers. isWorkCategoryTopCode keeps it top-level (5-char subsections excluded).
    supabase
      .from("work_categories")
      .select("id, code, name_th")
      .eq("is_active", true)
      .order("code", { ascending: true }),
    // Spec 369 U1: the level standards + firm WHT % feed the cost-confirm preview
    // (what confirm_worker_cost will stamp). Money columns, zero authenticated
    // grant — and the firm standard's app audience is /settings/labor-rates
    // (procurement_manager + super_admin), NARROWER than this page's gate, so the
    // read runs only for super_admin (the one role the confirm renders for) and
    // the numbers never enter a PM/procurement payload.
    ctx.role === "super_admin"
      ? admin.from("worker_level_rates").select("level, entered_rate, wht_basis")
      : Promise.resolve({ data: null, error: null }),
    ctx.role === "super_admin"
      ? admin.from("labor_wht_config").select("wht_pct").eq("id", true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Fail loud on a standards read error (mirrors /settings/labor-rates): a masked
  // empty read would render the FALSE refusal "ยังไม่ได้ตั้งค่าแรงมาตรฐาน" on every
  // level, and a missing WHT % would under-preview an after_wht stamp.
  if (levelRatesRes.error || whtCfgRes.error) {
    throw new Error(
      `workers standards read failed: ${levelRatesRes.error?.message ?? whtCfgRes.error?.message}`,
    );
  }
  const levelRateRows = levelRatesRes.data;
  const whtCfgRow = whtCfgRes.data;

  // ADR 0062 U4a: derive portalBound from user_id (the LINE binding); user_id
  // itself stays server-side — only the boolean reaches the client roster.
  // DC edit matrix: withhold a bound worker's bank from the client entirely — once
  // bound, the ช่าง owns their bank via the portal request/approval flow, and the
  // edit sheet won't render it, so it must not ship in the props either.
  // Spec 332: group trade tags by worker (primary-first ordering lives in the
  // component). Only tags whose category is a top-level W0x survive — a defensive
  // filter mirroring the RPC's own grain guard.
  const tradesByWorker = new Map<string, WorkerTrade[]>();
  for (const t of tradeRows ?? []) {
    const cat = t.work_categories;
    if (!cat || !isWorkCategoryTopCode(cat.code)) continue;
    const list = tradesByWorker.get(t.worker_id) ?? [];
    list.push({
      categoryId: t.work_category_id,
      code: cat.code,
      nameTh: cat.name_th,
      isPrimary: t.is_primary,
    });
    tradesByWorker.set(t.worker_id, list);
  }
  const tradeOptions: TradeOption[] = (tradeCategoryRows ?? [])
    .filter((c) => isWorkCategoryTopCode(c.code))
    .map((c) => ({ id: c.id, code: c.code, nameTh: c.name_th }));

  // Spec 369 U1: the GROSS standard rate per level — the number the confirm will
  // stamp. Same derivation as /settings/labor-rates (shared grossRate); a level
  // missing from the seed previews as null, which BLOCKS its confirm in the sheet
  // (confirm_worker_cost would coalesce to the existing day_rate — ฿0 on the
  // unfed roster, a confirmation derive_muster_labor still skips).
  const whtPctRaw = whtCfgRow?.wht_pct;
  const whtPct = whtPctRaw === undefined || whtPctRaw === null ? null : Number(whtPctRaw);
  const levelRates = Object.fromEntries(
    WORKER_LEVEL_ORDER.map((l) => {
      const row = (levelRateRows ?? []).find((r) => r.level === l);
      return [
        l,
        row
          ? grossRate(
              row.entered_rate === null ? null : Number(row.entered_rate),
              row.wht_basis,
              whtPct,
            )
          : null,
      ];
    }),
  ) as LevelRates;

  const workers: ManagedWorker[] = (workerRows ?? []).map(
    ({ user_id, bank_name, bank_account_number, bank_account_name, ...w }) => {
      const portalBound = user_id !== null;
      return {
        ...w,
        portalBound,
        trades: tradesByWorker.get(w.id) ?? [],
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
          canSetTrades={PM_ROLES.includes(ctx.role)}
          tradeOptions={tradeOptions}
          // Money-audience guard: only the role that can confirm receives the firm
          // standard (conditional SPREAD — `levelRates={undefined}` would violate
          // exactOptionalPropertyTypes and still serialize a key).
          {...(ctx.role === "super_admin" ? { levelRates } : {})}
        />
      </div>
    </PageShell>
  );
}
