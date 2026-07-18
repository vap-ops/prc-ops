// Spec 323 U3b — a focused STR section of the Procurement hub. The bottom-tab
// spine lands here (ขอบเขต /procurement/scope · เวลา /procurement/time ·
// ทรัพยากร /procurement/resources): same chrome + strip + lens + nudge as the
// full hub, but only that section's doors. Sections are distinct SUB-ROUTES
// (not ?section=) because the bottom-tab active rule is a query-blind
// longest-pathname-prefix — only a pathname can light exactly one tab. An
// unknown section 404s via parseProcurementSection. This is a hub variant, not
// a drill-down — no back chip (nav-back-affordance classifies it NON_DETAIL).

import { notFound } from "next/navigation";

import { PageShell } from "@/components/features/chrome/page-shell";
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { parseProcurementSection } from "@/lib/purchasing/procurement-home";
import { PROCUREMENT_HOME_ROLES, ProcurementHubBody } from "../hub-body";

export const metadata = { title: "จัดซื้อ" };

interface ProcurementSectionProps {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ project?: string | string[]; view?: string | string[] }>;
}

export default async function ProcurementSectionPage({
  params,
  searchParams,
}: ProcurementSectionProps) {
  const { section: rawSection } = await params;
  const section = parseProcurementSection(rawSection);
  if (section === null) notFound();

  const ctx = await requireRole([...PROCUREMENT_HOME_ROLES]);
  const currentHref = `/procurement/${section}`;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="จัดซื้อ" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />
      <HubNav
        items={hubNavForRole(ctx.role) ?? []}
        currentHref={currentHref}
        maxWidthClass={PAGE_MAX_W}
        role={ctx.role}
      />
      <ProcurementHubBody
        role={ctx.role}
        section={section}
        currentHref={currentHref}
        searchParams={searchParams}
      />
    </PageShell>
  );
}
