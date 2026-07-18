// Spec 323 U3a/U3b — the Procurement Home hub (portfolio landing + procurement's
// roleHome since U3b). Mirrors the /team hub chrome (PageShell + BottomTabBar +
// AppHeader + HubNav — no back chip); the body (status strip + <ProjectLens> +
// three STR door sections + the คำขอสมัคร nudge) is the shared ProcurementHubBody,
// which /procurement/[section] renders one section of.

import { PageShell } from "@/components/features/chrome/page-shell";
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PROCUREMENT_HOME_ROLES } from "./hub-body";
import { ProcurementDashboardBody } from "./dashboard-body";

export const metadata = { title: "จัดซื้อ" };

export default async function ProcurementHomePage() {
  const ctx = await requireRole([...PROCUREMENT_HOME_ROLES]);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="จัดซื้อ" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />
      <HubNav
        items={hubNavForRole(ctx.role) ?? []}
        currentHref="/procurement"
        maxWidthClass={PAGE_MAX_W}
        role={ctx.role}
      />
      {/* Spec 327 U1 — the root renders the selection-first dashboard; the
          section pages (/procurement/[section]) keep ProcurementHubBody. */}
      <ProcurementDashboardBody role={ctx.role} />
    </PageShell>
  );
}
