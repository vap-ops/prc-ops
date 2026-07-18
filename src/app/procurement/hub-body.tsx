// Spec 323 U3b — the Procurement hub's shared BODY (status strip + <ProjectLens>
// + STR door sections + the คำขอสมัคร nudge, with their data reads), extracted
// from the U3a page so /procurement (all three sections) and
// /procurement/[section] (one section, the bottom-tab landing) render the same
// content without forking. The page chrome (PageShell + BottomTabBar + AppHeader
// + HubNav) stays in each page.tsx — the nav-back-affordance guard classifies
// hubs by reading the page source. Reads are COUNTS only (never a ฿ field) so
// the surface stays off the money surface.

import Link from "next/link";
import { UserPlus } from "lucide-react";

import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { STAFF_APPROVAL_ROLES, type UserRole } from "@/lib/auth/role-home";
import { withBackFrom } from "@/lib/nav/back-href";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { loadProjectLensNames } from "@/lib/nav/project-lens";
import { ProjectLens } from "@/components/features/common/project-lens";
import {
  buildProcurementProjectStatus,
  effectiveDoorProjectId,
  procurementDoorHref,
  procurementStripHref,
  visibleProcurementDoors,
  PROCUREMENT_STR_SECTIONS,
  type ProcurementStrSection,
} from "@/lib/purchasing/procurement-home";
import { listVisibleTechnicianRegistrations } from "@/lib/register/admin-registrations";

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
  /** null = the full hub (all three STR sections); a key = that section only. */
  section: ProcurementStrSection["key"] | null;
  /** The page's own pathname — feeds hubFrom (the ?from= referrer on door tiles). */
  currentHref: string;
  searchParams: Promise<{ project?: string | string[] }>;
}

export async function ProcurementHubBody({
  role,
  section,
  currentHref,
  searchParams,
}: ProcurementHubBodyProps) {
  const supabase = await createClient();

  const { project } = await searchParams;
  const activeProjectId = typeof project === "string" && project !== "" ? project : null;
  // Nav-coherence audit 2026-07 (Decision 1): thread this hub as the ?from referrer
  // on each STR door, so a door page's back chip returns HERE (the exact section +
  // active project) instead of the door's hardcoded /settings|/equipment fallback.
  const hubFrom = activeProjectId ? `${currentHref}?project=${activeProjectId}` : currentHref;
  const isManager = role === "procurement_manager" || role === "super_admin";
  const isApprover = STAFF_APPROVAL_ROLES.includes(role);

  // Per-project status strip: the caller's visible PRs (RLS-scoped), counted by
  // project. project_id / status / eta are granted columns — no ฿ read here.
  const { data: prRows } = await supabase
    .from("purchase_requests")
    .select("project_id, status, eta");
  const rows = (prRows ?? []).map((r) => ({
    projectId: r.project_id,
    status: r.status,
    eta: r.eta,
  }));
  const projectIds = Array.from(
    new Set(rows.map((r) => r.projectId).filter((id): id is string => id !== null)),
  );
  const names = await loadProjectLensNames(supabase, projectIds);
  const projectStatus = buildProcurementProjectStatus(rows, names, bangkokTodayIso());
  const lensProjects = projectStatus.map((p) => ({ id: p.projectId, name: p.name }));
  // 📍 project-scope doors (ต้นทุนโครงการ, แผนจัดหา) resolve to the selected
  // project — or, in a single-project world where the lens shows no chips, the
  // sole project — so they aren't invisible for the common one-project case.
  // ONLY 📍 doors use this: shared/spanning doors + the lens/strip/hubFrom keep
  // the raw activeProjectId, so a single-project user's จัดซื้อ/payroll/expenses
  // doors are NOT silently scoped to ?project= (that would drop store-bound
  // null-project rows + suppress payroll reconciliation — the invisible-filter
  // trap removed from the strip, zeeparn 2026-07-17).
  const doorProjectId = effectiveDoorProjectId(activeProjectId, lensProjects);

  // Re-homed staff-registration queue (retired /team tab): approvers get a nudge
  // + pending count. RLS hands approvers all statuses → narrow to pending.
  const pendingCount = isApprover
    ? (await listVisibleTechnicianRegistrations(supabase)).filter((r) => r.status === "pending")
        .length
    : 0;

  const sections =
    section === null
      ? PROCUREMENT_STR_SECTIONS
      : PROCUREMENT_STR_SECTIONS.filter((s) => s.key === section);

  return (
    <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
      {/* Universal cross-project filter (collapses at ≤1 named project). */}
      <ProjectLens projects={lensProjects} />

      {/* Per-project status strip — open ขอซื้อ + arrivals-today. The tap goes
          where the counts point (that project's จัดซื้อ list; the หน้าหลัก tab
          is the way back — /requests is a tab page, no back chip); scoping the
          hub itself is the lens chips' job (feedback 2026-07-17: re-scoping on
          tap was invisible for a single-project user). */}
      {projectStatus.length > 0 ? (
        <div className="flex flex-col gap-2">
          {projectStatus.map((p) => (
            <Link
              key={p.projectId}
              href={procurementStripHref(p.projectId)}
              className="rounded-card shadow-card border-edge bg-card text-ink hover:bg-sunk flex min-h-11 items-center gap-3 border px-4 py-3"
            >
              <span className="text-body min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <span className="text-ink-secondary text-meta shrink-0">ขอซื้อ {p.openCount}</span>
              {p.arrivalsToday > 0 ? (
                <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                  ของเข้าวันนี้ {p.arrivalsToday}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}

      {/* STR sections of door tiles; 🔀 doors carry the active project, 📍
          doors (per-project targets) render only while the lens has one. */}
      {sections.map((sectionItem) => {
        const doors = visibleProcurementDoors(sectionItem, isManager, doorProjectId);
        return (
          <div key={sectionItem.key} className="flex flex-col gap-3">
            <h2 className="text-body text-ink-secondary font-semibold">{sectionItem.label}</h2>
            <div className="grid grid-cols-2 gap-3">
              {doors.map((door) => (
                <Link
                  key={door.key}
                  href={withBackFrom(
                    procurementDoorHref(
                      door,
                      door.scope === "project" ? doorProjectId : activeProjectId,
                    ),
                    hubFrom,
                  )}
                  className="rounded-card border-edge bg-card shadow-card hover:bg-sunk text-ink flex min-h-11 items-center justify-center border px-4 py-3 text-center text-sm font-semibold"
                >
                  {door.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {/* Re-homed คำขอสมัคร approval nudge (approvers only). */}
      {isApprover ? (
        <Link
          href="/registrations"
          className="rounded-card border-edge bg-card shadow-card hover:bg-sunk flex items-center gap-3 border px-4 py-3"
        >
          <UserPlus aria-hidden className="text-action size-5 shrink-0" />
          <span className="text-body text-ink min-w-0 flex-1 font-medium">คำขอสมัคร</span>
          {pendingCount > 0 ? (
            <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
              {pendingCount}
            </span>
          ) : null}
        </Link>
      ) : null}
    </section>
  );
}
