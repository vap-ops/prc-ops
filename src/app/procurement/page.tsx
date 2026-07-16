// Spec 323 U3a — the Procurement Home hub (portfolio landing). Mirrors the /team
// hub chrome (PageShell + BottomTabBar + AppHeader + HubNav — no back chip): a
// per-project status strip, the universal <ProjectLens> filter, three STR
// sections of door tiles, and the re-homed คำขอสมัคร approval nudge. Reads are
// COUNTS only (never a ฿ field) so the page stays off the money surface. Built as
// a standalone reachable surface; U3b wires it as procurement's landing + tab.

import Link from "next/link";
import { UserPlus } from "lucide-react";

import { PageShell } from "@/components/features/chrome/page-shell";
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { STAFF_APPROVAL_ROLES, type UserRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { loadProjectLensNames } from "@/lib/nav/project-lens";
import { ProjectLens } from "@/components/features/common/project-lens";
import {
  buildProcurementProjectStatus,
  procurementDoorHref,
  PROCUREMENT_STR_SECTIONS,
} from "@/lib/purchasing/procurement-home";
import { listVisibleTechnicianRegistrations } from "@/lib/register/admin-registrations";

export const metadata = { title: "จัดซื้อ" };

// The procurement tier only — this STR hub is procurement's home (spec 323 §4),
// NOT a shared surface. PURCHASING_ROLES is too wide (its site_admin / PM / PD
// members have their own homes and would land on dead-end door tiles). super_admin
// is kept for admin + preview visibility. U3b makes this the procurement roleHome.
const PROCUREMENT_HOME_ROLES: readonly UserRole[] = [
  "procurement",
  "procurement_manager",
  "super_admin",
];

interface ProcurementHomeProps {
  searchParams: Promise<{ project?: string | string[] }>;
}

export default async function ProcurementHomePage({ searchParams }: ProcurementHomeProps) {
  const ctx = await requireRole([...PROCUREMENT_HOME_ROLES]);
  const supabase = await createClient();

  const { project } = await searchParams;
  const activeProjectId = typeof project === "string" && project !== "" ? project : null;
  const isManager = ctx.role === "procurement_manager" || ctx.role === "super_admin";
  const isApprover = STAFF_APPROVAL_ROLES.includes(ctx.role);

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

  // Re-homed staff-registration queue (retired /team tab): approvers get a nudge
  // + pending count. RLS hands approvers all statuses → narrow to pending.
  const pendingCount = isApprover
    ? (await listVisibleTechnicianRegistrations(supabase)).filter((r) => r.status === "pending")
        .length
    : 0;

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
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        {/* Universal cross-project filter (collapses at ≤1 named project). */}
        <ProjectLens projects={lensProjects} />

        {/* Per-project status strip — open ขอซื้อ + arrivals-today, tap to scope. */}
        {projectStatus.length > 0 ? (
          <div className="flex flex-col gap-2">
            {projectStatus.map((p) => {
              const active = activeProjectId === p.projectId;
              return (
                <Link
                  key={p.projectId}
                  href={`/procurement?project=${p.projectId}`}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-card shadow-card flex min-h-11 items-center gap-3 border px-4 py-3 ${
                    active
                      ? "border-fill bg-fill/10 text-ink"
                      : "border-edge bg-card text-ink hover:bg-sunk"
                  }`}
                >
                  <span className="text-body min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="text-ink-secondary text-meta shrink-0">
                    ขอซื้อ {p.openCount}
                  </span>
                  {p.arrivalsToday > 0 ? (
                    <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
                      ของเข้าวันนี้ {p.arrivalsToday}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : null}

        {/* Three STR sections of door tiles; 🔀 doors carry the active project. */}
        {PROCUREMENT_STR_SECTIONS.map((sectionItem) => {
          const doors = sectionItem.doors.filter((d) => !d.managerOnly || isManager);
          return (
            <div key={sectionItem.key} className="flex flex-col gap-3">
              <h2 className="text-body text-ink-secondary font-semibold">{sectionItem.label}</h2>
              <div className="grid grid-cols-2 gap-3">
                {doors.map((door) => (
                  <Link
                    key={door.key}
                    href={procurementDoorHref(door, activeProjectId)}
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
    </PageShell>
  );
}
