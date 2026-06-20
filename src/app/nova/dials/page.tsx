// Spec 161 U7 — the Nova dials calibration console. super_admin only: the dials
// (nova_dials) + per-level sell rates (sell_rate_table) are economics (zero-grant
// money), read here via the ADMIN client behind requireRole and tuned via the
// SECURITY DEFINER setters (the form's actions). This is the go-live calibration
// surface: every dial seeded by U1/U4a/U5/U6b is a placeholder until set here.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { requireRole } from "@/lib/auth/require-role";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { NovaDialsForm } from "@/components/features/nova/nova-dials-form";
import type { WorkerLevel } from "@/lib/nova/dials";

export const metadata = { title: "ค่าปรับ Nova" };

export default async function NovaDialsPage() {
  const ctx = await requireRole(["super_admin"]);
  const admin = createAdminClient();

  const [{ data: dialRows }, { data: rateRows }] = await Promise.all([
    admin.from("nova_dials").select("dial_key, value"),
    admin.from("sell_rate_table").select("level, cost_band, internal_sell, external_sell"),
  ]);

  // numeric comes back as a string from PostgREST — Number() before the form.
  const dials = (dialRows ?? []).map((d) => ({ key: d.dial_key, value: Number(d.value) }));
  const rates = (rateRows ?? []).map((r) => ({
    level: r.level as WorkerLevel,
    cost_band: Number(r.cost_band),
    internal_sell: Number(r.internal_sell),
    external_sell: Number(r.external_sell),
  }));

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/nova" backLabel="Nova">
        <h1 className="text-title text-ink font-bold tracking-tight">ค่าปรับ Nova</h1>
        <p className="text-ink-secondary mt-0.5 text-xs">
          ตัวคูณ · ส่วนแบ่ง · น้ำหนักระดับ · ราคาขาย — ปรับก่อนใช้งานจริง
        </p>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <NovaDialsForm dials={dials} rates={rates} />
      </section>
    </PageShell>
  );
}
