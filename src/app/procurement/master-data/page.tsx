// Spec 361 U4 — /procurement/master-data: the ข้อมูลหลัก index. A leaf of the
// STR hub reached from the ทรัพยากร chip row; its back chip resolves ?from, and
// the ทรัพยากร bottom tab claims this pathname so the tab and the chip agree
// (without that `match` entry the query-blind longest-prefix rule lights หน้าหลัก,
// since every /procurement/* path is a prefix match for the hub itself).
//
// Counts come from loadMasterDataCounts (lib) — the table/filter mapping lives
// there so it can be pinned by test; this page is composition only.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { MasterDataBoard } from "@/components/features/purchasing/master-data-board";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { safeBackHref } from "@/lib/nav/back-href";
import { MASTER_DATA_HINT, MASTER_DATA_LABEL } from "@/lib/i18n/labels";
import { loadMasterDataCounts } from "@/lib/purchasing/master-data-counts";
import { PROCUREMENT_HOME_ROLES } from "../hub-body";

export const metadata = { title: MASTER_DATA_LABEL };

export default async function MasterDataPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const ctx = await requireRole([...PROCUREMENT_HOME_ROLES]);
  const supabase = await createClient();
  const counts = await loadMasterDataCounts(supabase);

  // Each row's link threads THIS page plus the referrer that reached it, so a
  // second-level back chip returns here and a third returns where she started.
  const selfHref = from
    ? `/procurement/master-data?from=${encodeURIComponent(from)}`
    : "/procurement/master-data";

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={safeBackHref(from, "/procurement/resources")} backLabel="ทรัพยากร">
        <h1 className="text-title text-ink font-bold tracking-tight">{MASTER_DATA_LABEL}</h1>
        <p className="text-ink-secondary text-meta">{MASTER_DATA_HINT}</p>
      </DetailHeader>
      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <MasterDataBoard
          counts={counts}
          from={selfHref}
          isManager={ctx.role === "procurement_manager" || ctx.role === "super_admin"}
        />
      </section>
    </PageShell>
  );
}
