// Spec 314 U2 / ADR 0082 — the PM editor for the firm-wide standard day-rate per
// skill level + the firm WHT %. The money columns (entered_rate, wht_pct) are
// zero-grant, so the seed is read via the admin (service-role) client server-side
// and rendered into the form; it never enters a client bundle beyond the numbers
// the PM is editing. requireRole is the page gate; the DEFINER RPCs re-gate writes.

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { safeBackHref } from "@/lib/nav/back-href";
import { PageShell } from "@/components/features/chrome/page-shell";
import { LevelRatesForm, type LevelRateRow } from "@/components/features/labor/level-rates-form";
import { PayModelExplainer } from "@/components/features/labor/pay-model-explainer";
import { requireRole } from "@/lib/auth/require-role";
import { createClient as createAdminClient } from "@/lib/db/admin";
import type { WhtBasis } from "@/lib/db/enums";
import { grossRate } from "@/lib/labor/gross-rate";
import { LABOR_RATES_HINT, LABOR_RATES_LABEL } from "@/lib/i18n/labels";
import { WORKER_LEVEL_ORDER } from "@/lib/nova/dials";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: LABOR_RATES_LABEL };

export default async function LaborRatesPage({
  searchParams,
}: {
  // Spec 327 U6b — multi-parent page (settings hub + /procurement chip row):
  // the back chip follows the ?from referrer (nav-coherence Decision 1).
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole(["procurement_manager", "super_admin"]);
  const admin = createAdminClient();

  const [ratesRes, cfgRes] = await Promise.all([
    admin.from("worker_level_rates").select("level, entered_rate, wht_basis"),
    admin.from("labor_wht_config").select("wht_pct").eq("id", true).maybeSingle(),
  ]);

  // Fail loud on a read error — a masked-empty grid would show every rate as unset
  // and let the PM overwrite live rates on top of a failed read.
  if (ratesRes.error || cfgRes.error) {
    throw new Error(`labor-rates read failed: ${ratesRes.error?.message ?? cfgRes.error?.message}`);
  }

  const rawPct = cfgRes.data?.wht_pct;
  const whtPct = rawPct === undefined || rawPct === null ? null : Number(rawPct);

  const byLevel = new Map((ratesRes.data ?? []).map((r) => [r.level, r]));
  // Levels high→low (WORKER_LEVEL_ORDER SSOT). A level missing from the seed still
  // renders (basis after_wht) so the PM can set a brand-new level's rate.
  const rows: LevelRateRow[] = WORKER_LEVEL_ORDER.map((level) => {
    const r = byLevel.get(level);
    const enteredRate =
      r?.entered_rate === undefined || r?.entered_rate === null ? null : Number(r.entered_rate);
    const basis = (r?.wht_basis ?? "after_wht") as WhtBasis;
    return { level, enteredRate, basis, grossRate: grossRate(enteredRate, basis, whtPct) };
  });

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/settings")} backLabel="กลับไปตั้งค่า">
        {/* Spec 362 U2 — the registry h1 token, shared with /catalog, /equipment
            and /workers. This page had drifted to text-lg font-semibold. */}
        <h1 className="text-title text-ink font-bold tracking-tight">{LABOR_RATES_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-5 px-5 py-6`}>
        <p className="text-ink-secondary text-meta">{LABOR_RATES_HINT}</p>
        <PayModelExplainer />
        <LevelRatesForm rows={rows} whtPct={whtPct} />
      </section>
    </PageShell>
  );
}
