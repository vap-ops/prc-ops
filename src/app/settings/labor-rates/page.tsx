// Spec 314 U2 / ADR 0082 — the PM editor for the firm-wide standard day-rate per
// skill level + the firm WHT %. The money columns (entered_rate, wht_pct) are
// zero-grant, so the seed is read via the admin (service-role) client server-side
// and rendered into the form; it never enters a client bundle beyond the numbers
// the PM is editing. requireRole is the page gate; the DEFINER RPCs re-gate writes.

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { LevelRatesForm, type LevelRateRow } from "@/components/features/labor/level-rates-form";
import { PayModelExplainer } from "@/components/features/labor/pay-model-explainer";
import { requireRole } from "@/lib/auth/require-role";
import { createClient as createAdminClient } from "@/lib/db/admin";
import type { WhtBasis } from "@/lib/db/enums";
import { round2 } from "@/lib/format";
import { LABOR_RATES_HINT, LABOR_RATES_LABEL } from "@/lib/i18n/labels";
import { WORKER_LEVEL_ORDER } from "@/lib/nova/dials";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

export const metadata = { title: LABOR_RATES_LABEL };

// Gross day-rate from the entered rate per basis + firm % — re-derives the DB's
// level_gross_rate() here in the server component because that function is
// owner/DEFINER-only and can't be called from the admin client. Formula kept
// identical: before_wht → entered as-is; after_wht → entered / (1 − pct/100), 2dp.
// Display-only preview of what U3's confirm_worker_cost will stamp; the DB value is
// canonical (a half-cent float boundary could differ by 0.01 from this preview).
function grossRate(entered: number | null, basis: WhtBasis, pct: number | null): number | null {
  if (entered === null) return null;
  if (basis === "before_wht") return entered;
  const p = pct ?? 0;
  return round2(entered / (1 - p / 100));
}

export default async function LaborRatesPage() {
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
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{LABOR_RATES_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-5 px-5 py-6`}>
        <p className="text-ink-soft text-meta">{LABOR_RATES_HINT}</p>
        <PayModelExplainer />
        <LevelRatesForm rows={rows} whtPct={whtPct} />
      </section>
    </PageShell>
  );
}
