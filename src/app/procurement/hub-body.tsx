// Spec 323 U3b → 327 U6c — the Procurement section-page BODY. Since U6c the
// section pages render ONLY their door chip row + project view (the U1-U5
// views): the text door grids, the per-project status strip, the <ProjectLens>
// filter, and the section-page คำขอสมัคร nudge all retired — the dashboard
// (หน้าหลัก) is the selection + alert surface now, and the chip row on top is
// the door path (with the labeled ทั้งหมด grid on หน้าหลัก as the rule-4
// labeled path). The page chrome (PageShell + BottomTabBar + AppHeader +
// HubNav) stays in each page.tsx — the nav-back-affordance guard classifies
// hubs by reading the page source.

import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { type UserRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { ProcurementDoorChips } from "@/components/features/purchasing/procurement-door-chips";
import {
  PROCUREMENT_STR_SECTIONS,
  type ProcurementStrSection,
} from "@/lib/purchasing/procurement-home";
import { resolveSelectedProject } from "@/lib/purchasing/procurement-project";
import { readProcurementProjectCookie } from "@/lib/purchasing/procurement-project.server";
import { parseTimeView } from "@/lib/purchasing/time-view";
import { ResourcesView } from "./resources-view";
import { ScopeView } from "./scope-view";
import { TimeView } from "./time-view";

// The procurement tier only — the STR hub is procurement's home (spec 323 §4),
// NOT a shared surface. PURCHASING_ROLES is too wide (its site_admin / PM / PD
// members have their own homes and would land on dead-end door tiles).
// super_admin is kept for admin + preview visibility. Shared by /procurement
// and /procurement/[section] (both gate on it).
export const PROCUREMENT_HOME_ROLES: readonly UserRole[] = [
  "procurement",
  "procurement_manager",
  "super_admin",
];

interface ProcurementHubBodyProps {
  role: UserRole;
  /** null = the root (unused since U1 — the dashboard renders instead); a key = that section. */
  section: ProcurementStrSection["key"] | null;
  /** The page's own pathname — the chip row's ?from referrer. */
  currentHref: string;
  searchParams: Promise<{ project?: string | string[]; view?: string | string[] }>;
}

export async function ProcurementHubBody({
  role,
  section,
  currentHref,
  searchParams,
}: ProcurementHubBodyProps) {
  const { view } = await searchParams;
  const timeSubView = parseTimeView(typeof view === "string" ? view : null);
  const isManager = role === "procurement_manager" || role === "super_admin";

  // 📍 chips resolve via the U1 SELECTION (cookie; sole-project auto) against
  // the FULL RLS project list — selection-first, and no longer limited to
  // open-PR projects (the retired strip's derivation).
  const supabase = await createClient();
  const { data: projectRows } = await supabase.from("projects").select("id");
  const doorProjectId = resolveSelectedProject(
    await readProcurementProjectCookie(),
    (projectRows ?? []).map((p) => p.id),
  );

  const sectionDoors =
    section === null ? [] : (PROCUREMENT_STR_SECTIONS.find((s) => s.key === section)?.doors ?? []);

  return (
    <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
      {/* The section's doors as icon chips on top (checkpoint-2 idiom). */}
      {sectionDoors.length > 0 ? (
        <ProcurementDoorChips
          doors={sectionDoors}
          isManager={isManager}
          activeProjectId={doorProjectId}
          from={currentHref}
        />
      ) : null}

      {section === "scope" ? <ScopeView /> : null}
      {section === "time" ? <TimeView view={timeSubView} /> : null}
      {section === "resources" ? <ResourcesView /> : null}
    </section>
  );
}
