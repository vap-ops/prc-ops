// Spec 334 U3 — the /team people hub, recomposed วันนี้-first. Spec 313 U1 stacked
// five surfaces here (~30 rows for a site_admin, of which three were actionable);
// spec 334 leads with the attendance hero and turns the rest into a scannable icon
// grid. It is a HUB, not a drill-down: BottomTabBar + HubNav chrome, no back chip.
// The audience is the union of today's crew/roster owners — site staff (SA + PM
// tier) plus procurement — composed at the call site from the exported role sets,
// so no new named auth set is introduced. Role-gated within: the SA/super_admin
// crew pair gets the hero + crew doors; STAFF_APPROVAL_ROLES / WORKER_ROSTER_ROLES
// get their own tiles (all resolved inside teamTilesForRole). The merged roster and
// the site board moved to /team/roster (U2); check-in stays in the cockpit (D2).

import QRCode from "qrcode";
import { PageShell } from "@/components/features/chrome/page-shell";
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { SITE_STAFF_ROLES, STAFF_APPROVAL_ROLES, type UserRole } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { clientEnv } from "@/lib/env";
import { formatThaiDate } from "@/lib/i18n/labels";
import { technicianOnboardUrl } from "@/lib/register/onboard-link";
import { listVisibleTechnicianRegistrations } from "@/lib/register/admin-registrations";
import {
  AddTechnicianSheet,
  type AddTechnicianQrCard,
  type SubconFirmQrCard,
} from "@/components/features/sa/add-technician-sheet";
import { MusterTodayCard } from "@/components/features/sa/muster-today-card";
import { loadMusterDaySummary, type MusterDaySummary } from "@/lib/muster/day-summary";
import { TeamTiles, teamTilesForRole } from "@/components/features/sa/team-tiles";
import { getSaCurrentProject } from "@/lib/sa/current-project.server";

export const metadata = { title: "ทีมงาน" };

// Spec 313 U1: the people-domain hub — union of today's audiences, composed at the
// call site from the existing exported sets (no new named set → no auth-path edit).
const TEAM_PAGE_ROLES: readonly UserRole[] = [
  ...new Set<UserRole>([...SITE_STAFF_ROLES, "procurement", "procurement_manager"]),
];

export default async function TeamPage() {
  const ctx = await requireRole([...TEAM_PAGE_ROLES]);
  const supabase = await createClient();
  const isCrew = ctx.role === "site_admin" || ctx.role === "super_admin";
  const isApprover = STAFF_APPROVAL_ROLES.includes(ctx.role);
  const today = bangkokTodayIso();

  // Crew-scoped outputs — populated ONLY for the SA/super_admin crew view: the
  // AddTechnicianSheet inputs (QR cards), the วันนี้ hero's muster summary, and the
  // tile-bubble counts. The board/roster queries LEFT the hub in spec 334 (they run
  // on /team/roster now); this block keeps only what the hub itself still shows.
  let projectList: { id: string; code: string; name: string }[] = [];
  let qrCards: AddTechnicianQrCard[] = [];
  let firmQrCards: SubconFirmQrCard[] = [];
  let musterSummary: MusterDaySummary | null = null;
  let musterProjectId: string | null = null;
  let musterProjectName = "";
  let activeWorkerCount = 0;
  let unassignedCount = 0;
  let saPendingCount = 0;

  if (isCrew) {
    // The SA's projects (RLS-scoped via their visible work packages, ADR 0056).
    const { data: wpRows } = await supabase
      .from("work_packages")
      .select("project_id")
      .eq("is_group", false);
    const projectIds = Array.from(new Set((wpRows ?? []).map((w) => w.project_id)));

    const [projectRes, workerRes, memberRes, saQueue] = await Promise.all([
      projectIds.length
        ? supabase.from("projects").select("id, code, name").in("id", projectIds)
        : Promise.resolve({ data: null }),
      // Active workers on the SA's projects — id only: the active-worker total and
      // the unassigned count drive the รายชื่อทีม / ยังไม่จัดทีม tile bubbles.
      projectIds.length
        ? supabase.from("workers").select("id").eq("active", true).in("project_id", projectIds)
        : Promise.resolve({ data: null }),
      // Active crew memberships (RLS-scoped to the SA's visible crews) — the assigned
      // worker_ids; unassigned = active workers minus these (spec 334 count).
      projectIds.length
        ? supabase.from("crew_members").select("worker_id").is("removed_at", null)
        : Promise.resolve({ data: null }),
      // /sa/registrations is the site_admin queue (RLS returns pending only) — its
      // length is the คำขอสมัคร bubble for site_admin; super_admin uses the approver
      // path below, so it fetches nothing here.
      ctx.role === "site_admin"
        ? listVisibleTechnicianRegistrations(supabase)
        : Promise.resolve([]),
    ]);

    projectList = (projectRes.data ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name }));

    const workerRows = workerRes.data ?? [];
    activeWorkerCount = workerRows.length;
    const assignedWorkerIds = new Set((memberRes.data ?? []).map((m) => m.worker_id));
    unassignedCount = workerRows.filter((w) => !assignedWorkerIds.has(w.id)).length;
    saPendingCount = saQueue.length;

    // One self-onboard QR per project (มีมือถือ path). Each carries its own project
    // (+ the inviting SA's id) so a ช่าง scanning at a site lands on the technician
    // register already told which project they're joining. Absolute URL so it
    // resolves from the ช่าง's own device.
    qrCards = await Promise.all(
      projectList.map(async (project) => {
        const url = technicianOnboardUrl(clientEnv.NEXT_PUBLIC_APP_URL, {
          projectId: project.id,
          siteLabel: project.name,
          inviterId: ctx.id,
        });
        const svg = await QRCode.toString(url, {
          type: "svg",
          margin: 1,
          width: 208,
          color: { dark: "#000000", light: "#ffffff" },
        });
        return { project, url, svg };
      }),
    );

    // Spec 328 U2 — one bank-free onboarding QR per (active contractor × project).
    const { data: contractorRows } = await supabase
      .from("contractors")
      .select("id, name")
      .eq("status", "active")
      .order("name");
    const activeFirms = contractorRows ?? [];
    firmQrCards = await Promise.all(
      projectList.flatMap((project) =>
        activeFirms.map(async (firm) => {
          const url = technicianOnboardUrl(clientEnv.NEXT_PUBLIC_APP_URL, {
            projectId: project.id,
            siteLabel: project.name,
            inviterId: ctx.id,
            contractorId: firm.id,
            firmLabel: firm.name,
          });
          const svg = await QRCode.toString(url, {
            type: "svg",
            margin: 1,
            width: 208,
            color: { dark: "#000000", light: "#ffffff" },
          });
          return { contractor: firm, project: { id: project.id, name: project.name }, url, svg };
        }),
      ),
    );

    // The เช็คชื่อ hero: the SA's resolved current project (spec 292) → its วันนี้
    // muster summary (a narrow three-number read; the cockpit stays the write path).
    const { current, visibleProjects } = await getSaCurrentProject(supabase, ctx.id);
    musterProjectId = current.projectId;
    if (musterProjectId) {
      musterProjectName = visibleProjects.find((p) => p.id === musterProjectId)?.name ?? "";
      musterSummary = await loadMusterDaySummary(supabase, musterProjectId, today);
    }
  }

  // The คำขอสมัคร bubble count: site_admin reads its /sa queue (pending-only above);
  // the approver tiers filter their all-status queue to the pending ones.
  const approverPending = isApprover
    ? (await listVisibleTechnicianRegistrations(supabase)).filter((r) => r.status === "pending")
        .length
    : 0;
  const pendingRegistrations = ctx.role === "site_admin" ? saPendingCount : approverPending;

  const tiles = teamTilesForRole({
    role: ctx.role,
    isCrew,
    counts: {
      pendingRegistrations,
      unassigned: unassignedCount,
      activeWorkers: activeWorkerCount,
    },
  });

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="ทีมงาน" fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />
      <HubNav
        items={hubNavForRole(ctx.role) ?? []}
        currentHref="/team"
        maxWidthClass={PAGE_MAX_W}
        role={ctx.role}
      />
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        {/* วันนี้ hero — who is on site today (spec 334 U1). Rendered for the crew
            view with a resolved current project; the cockpit owns check-in (D2). */}
        {isCrew && musterProjectId && musterSummary ? (
          <MusterTodayCard
            summary={musterSummary}
            projectId={musterProjectId}
            projectName={musterProjectName}
            dateLabel={formatThaiDate(today)}
          />
        ) : null}

        {/* The icon-tile grid (spec 334 U3). For the crew view the grid is wrapped by
            the ONE AddTechnicianSheet so its เพิ่มช่าง + QR สมัคร tiles open it; the
            staged onboarding roster and the site board moved to /team/roster. */}
        {isCrew ? (
          <AddTechnicianSheet projects={projectList} qrCards={qrCards} firmQrCards={firmQrCards}>
            <TeamTiles tiles={tiles} />
          </AddTechnicianSheet>
        ) : (
          <TeamTiles tiles={tiles} />
        )}
      </section>
    </PageShell>
  );
}
