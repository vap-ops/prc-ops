// Spec 284 U5 / ADR 0080 — /legal: the Legal department's home. requireRole(
// LEGAL_ROLES) gates the surface; the two working counts (active contracts,
// pending = draft contracts) come from the admin client because contracts is
// zero-authenticated-grant (spec 46 money/document posture) — never RLS, never a
// site_admin-reachable screen. The entry cards drill into /legal/contracts and
// /legal/approvals. This is the landing roleHome('legal') sends the role to (U1
// deferred it; U5 lands it).

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { requireRole } from "@/lib/auth/require-role";
import { LEGAL_ROLES } from "@/lib/auth/role-home";
import { createClient as createAdminClient } from "@/lib/db/admin";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { LEGAL_LABEL } from "@/lib/i18n/labels";
import { LegalHome } from "@/components/features/legal/legal-home";

export const metadata = { title: "ฝ่ายกฎหมาย" };

export default async function LegalPage() {
  const ctx = await requireRole(LEGAL_ROLES);

  const admin = createAdminClient();
  const [activeRes, draftRes] = await Promise.all([
    admin.from("contracts").select("*", { count: "exact", head: true }).eq("status", "active"),
    admin.from("contracts").select("*", { count: "exact", head: true }).eq("status", "draft"),
  ]);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref="/settings" backLabel="ตั้งค่า">
        <h1 className="text-title text-ink font-bold tracking-tight">{LEGAL_LABEL}</h1>
      </DetailHeader>

      <section className={`mx-auto w-full ${PAGE_MAX_W} px-5 py-6`}>
        <LegalHome activeContracts={activeRes.count ?? 0} pendingApprovals={draftRes.count ?? 0} />
      </section>
    </PageShell>
  );
}
