// Spec 313 U1 — the /team people hub. Absorbs the old /sa/crew surface (the
// SA's crew roster + site team board + technician onboarding, spec 279/282/298/
// 306) and fronts the เช็คชื่อ (muster) cockpit as its top CTA. It is a HUB, not
// a drill-down: BottomTabBar + HubNav chrome, no back chip. The audience is the
// union of today's crew/roster owners — site staff (SA + PM tier) plus
// procurement — composed at the call site from the exported role sets, so no new
// named auth set is introduced. Role-gated within: SA/super_admin run the crew
// loaders; STAFF_APPROVAL_ROLES see the คำขอสมัคร queue; WORKER_ROSTER_ROLES get
// the roster + wages drill-downs. Money columns are zero-grant and never read here.

import Link from "next/link";
import QRCode from "qrcode";
import { ScanLine, HardHat, Wallet, UserPlus } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import {
  SITE_STAFF_ROLES,
  STAFF_APPROVAL_ROLES,
  WORKER_ROSTER_ROLES,
  type UserRole,
} from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { bangkokTodayIso } from "@/lib/dates";
import { clientEnv } from "@/lib/env";
import { technicianOnboardUrl } from "@/lib/register/onboard-link";
import { listVisibleTechnicianRegistrations } from "@/lib/register/admin-registrations";
import {
  CrewProgressRoster,
  type CrewProgressData,
  type CrewProgressMember,
} from "@/components/features/sa/crew-progress-roster";
import { SiteTeamBoard } from "@/components/features/sa/site-team-board";
import { buildCrewTeams } from "@/lib/sa/crew-teams";
import { buildSiteTeamBoard, type SiteAccessMember } from "@/lib/sa/site-team-board";
import {
  AddTechnicianSheet,
  type AddTechnicianQrCard,
  type SubconFirmQrCard,
} from "@/components/features/sa/add-technician-sheet";
import { getSaCurrentProject } from "@/lib/sa/current-project.server";
import { musterHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { MUSTER_LABEL, WORKER_ROSTER_LABEL } from "@/lib/i18n/labels";

export const metadata = { title: "ทีมงาน" };

const NO_NAME = "ยังไม่กรอกชื่อ";

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
  const isBackOffice = WORKER_ROSTER_ROLES.includes(ctx.role);

  // Crew-scoped outputs — populated ONLY for the SA/super_admin crew view; the
  // non-crew roles (PM tier, procurement) never run the SA-scoped RPCs below.
  let projectList: { id: string; code: string; name: string }[] = [];
  let qrCards: AddTechnicianQrCard[] = [];
  let firmQrCards: SubconFirmQrCard[] = [];
  let crewData: CrewProgressData = { needsReview: [], awaitingConfirm: [], ready: [] };
  let siteBoard: ReturnType<typeof buildSiteTeamBoard> | null = null;
  let musterProjectId: string | null = null;

  if (isCrew) {
    // The SA's projects (RLS-scoped via their visible work packages, ADR 0056) →
    // the active workers on those projects (name + project + the non-money
    // onboarding discriminators cost_confirmed_at/level, all granted reads).
    const { data: wpRows } = await supabase
      .from("work_packages")
      .select("project_id")
      .eq("is_group", false);
    const projectIds = Array.from(new Set((wpRows ?? []).map((w) => w.project_id)));
    const today = bangkokTodayIso();

    const [projectRes, workerRes, crewRes, memberRes, planRes, categoryRes, pendingRegistrations] =
      await Promise.all([
        projectIds.length
          ? supabase.from("projects").select("id, code, name").in("id", projectIds)
          : Promise.resolve({ data: null }),
        projectIds.length
          ? supabase
              .from("workers")
              .select(
                "id, name, project_id, cost_confirmed_at, level, employment_type, contractor_id",
              )
              .eq("active", true)
              .in("project_id", projectIds)
              .order("name")
          : Promise.resolve({ data: null }),
        // Crews on the SA's projects (team dimension, U7b — readable via the site_admin
        // project-scoped read arm). default_day_rate is NOT selected (money zero-grant).
        projectIds.length
          ? supabase
              .from("crews")
              .select("id, name, lead_worker_id, kind")
              .eq("active", true)
              .in("project_id", projectIds)
          : Promise.resolve({ data: null }),
        // Active membership (RLS-scoped to the SA's visible crews). Worker↔crew derives
        // from here (the SSOT); removed_at IS NULL = the current roster.
        projectIds.length
          ? supabase.from("crew_members").select("crew_id, worker_id").is("removed_at", null)
          : Promise.resolve({ data: null }),
        // Upcoming แผนพรุ่งนี้ boards (today onward) — the source of the U6 per-crew งาน
        // label. Spec 273 grants SELECT + RLS-scopes via can_see_project.
        projectIds.length
          ? supabase
              .from("daily_work_plans")
              .select("id")
              .gte("plan_date", today)
              .in("project_id", projectIds)
          : Promise.resolve({ data: null }),
        // project_category id → GLOBAL work-category code (W0x) for the งาน category tile
        // (spec 277, same resolution the /sa home uses).
        projectIds.length
          ? supabase
              .from("project_categories")
              .select("id, work_categories(code)")
              .in("project_id", projectIds)
          : Promise.resolve({ data: null }),
        // /sa/registrations is the site_admin queue (RLS returns pending only);
        // super_admin uses /registrations, so it gets nothing here.
        ctx.role === "site_admin"
          ? listVisibleTechnicianRegistrations(supabase)
          : Promise.resolve([]),
      ]);

    // The งาน edge (U6): the SA's upcoming boards → their items → who is on each item
    // → the งานย่อย detail. Fetched after the plans resolve (each read narrows the next
    // by id, so RLS never full-scans). buildCrewTeams then maps items↔crew↔WP per crew.
    const planIds = (planRes.data ?? []).map((p) => p.id);
    const itemRes = planIds.length
      ? await supabase
          .from("daily_work_plan_items")
          .select("id, work_package_id")
          .in("plan_id", planIds)
      : { data: null };
    const planItems = itemRes.data ?? [];
    const itemIds = planItems.map((i) => i.id);
    const wpIds = Array.from(new Set(planItems.map((i) => i.work_package_id)));

    const [planCrewRes, wpRes] = await Promise.all([
      itemIds.length
        ? supabase.from("daily_work_plan_crew").select("item_id, worker_id").in("item_id", itemIds)
        : Promise.resolve({ data: null }),
      wpIds.length
        ? supabase.from("work_packages").select("id, code, name, category_id").in("id", wpIds)
        : Promise.resolve({ data: null }),
    ]);
    const planCrew = planCrewRes.data ?? [];

    const categoryCodeById = new Map<string, string>();
    for (const c of categoryRes.data ?? []) {
      const wc = c.work_categories;
      const code = (Array.isArray(wc) ? wc[0]?.code : wc?.code) ?? null;
      if (code) categoryCodeById.set(c.id, code);
    }
    const teamWorkPackages = (wpRes.data ?? []).map((wp) => ({
      id: wp.id,
      code: wp.code,
      name: wp.name,
      categoryCode: (wp.category_id && categoryCodeById.get(wp.category_id)) || null,
    }));

    projectList = (projectRes.data ?? []).map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
    }));
    const projectCode = new Map(projectList.map((p) => [p.id, p.code]));
    const multiProject = projectIds.length > 1;

    // Spec 298 U2 — active workers awaiting a PM's bank transcription (a phoneless
    // SA-add captured the passbook; status-only projection — the SA never sees the
    // photo or the bank fields). Drives the roster's "รอ PM กรอกบัญชี" chip.
    const bankStatuses = await Promise.all(
      projectIds.map((pid) => supabase.rpc("sa_worker_bank_status", { p_project: pid })),
    );
    const bankPending = new Set<string>();
    for (const res of bankStatuses)
      for (const row of res.data ?? [])
        if (row.status === "pending_pm") bankPending.add(row.worker_id);

    const toMember = (w: {
      id: string;
      name: string;
      project_id: string | null;
      level: CrewProgressMember["level"];
    }): CrewProgressMember => {
      const label = multiProject && w.project_id ? projectCode.get(w.project_id) : undefined;
      return {
        id: w.id,
        name: w.name,
        level: w.level,
        ...(label ? { projectLabel: label } : {}),
        ...(bankPending.has(w.id) ? { bankPending: true } : {}),
      };
    };

    const workerRows = workerRes.data ?? [];
    crewData = {
      needsReview: pendingRegistrations.map((r) => ({
        id: r.id,
        name: r.full_name?.trim() ? r.full_name : NO_NAME,
      })),
      awaitingConfirm: workerRows.filter((w) => w.cost_confirmed_at === null).map(toMember),
      ready: workerRows.filter((w) => w.cost_confirmed_at !== null).map(toMember),
    };

    // The crew (team) lens (U7b + U6) — the roster grouped by crew: each crew's lead +
    // members (with ประจำ/ชั่วคราว from employment_type) + the งาน it runs (U6). View-only.
    const teamData = buildCrewTeams({
      workers: workerRows.map((w) => ({
        id: w.id,
        name: w.name,
        level: w.level,
        employmentType: w.employment_type,
      })),
      crews: crewRes.data ?? [],
      members: memberRes.data ?? [],
      planItems,
      planCrew,
      workPackages: teamWorkPackages,
    });

    // Spec 282 U2 — the site team board. The ฝ่ายไซต์ (site-access) bucket = each
    // project's site_admin/site_owner members, via the U1 scoped definer read (an SA
    // can't read other users' role/name directly). Unioned across the SA's projects,
    // deduped by user. buildSiteTeamBoard then buckets the crews by nature (internal
    // workers crews vs external subcon crews) + annotates the cross-charges (approach A).
    const siteAccessResults = await Promise.all(
      projectIds.map((pid) => supabase.rpc("project_site_management", { p_project: pid })),
    );
    const siteAccessByUser = new Map<string, string | null>();
    for (const res of siteAccessResults) {
      for (const row of res.data ?? []) siteAccessByUser.set(row.user_id, row.display_name);
    }
    const siteAccess: SiteAccessMember[] = [...siteAccessByUser].map(([userId, name]) => ({
      userId,
      name,
    }));

    const crewKindById = new Map((crewRes.data ?? []).map((c) => [c.id, c.kind]));
    const contractorByWorker = new Map(workerRows.map((w) => [w.id, w.contractor_id]));

    siteBoard = buildSiteTeamBoard({
      teams: teamData.teams,
      unassigned: teamData.unassigned,
      crewKindById,
      contractorByWorker,
      siteAccess,
    });

    // One QR per project the SA runs. Each carries its own project (+ the inviting
    // SA's id) so a ช่าง scanning at a given site lands on /register/technician
    // already told WHICH project they're joining. Absolute URL so the QR resolves
    // from the ช่าง's own device.
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
    // Contractors are RLS-readable by site_admin ("readable by privileged roles").
    // The `firm` param is a display label; the `contractor` uuid is advisory and
    // the approver confirms the binding firm (F2b trust rule).
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

    // The เช็คชื่อ front door: the SA's resolved current project (spec 292). The
    // cockpit route itself stays project-scoped; /team just owns the entry.
    const saCurrent = await getSaCurrentProject(supabase, ctx.id);
    musterProjectId = saCurrent.current.projectId;
  }

  // Approver queue count — the คำขอสมัคร pipeline for STAFF_APPROVAL_ROLES. RLS
  // hands approvers every registration (all statuses), so narrow to the pending ones.
  const pendingCount = isApprover
    ? (await listVisibleTechnicianRegistrations(supabase)).filter((r) => r.status === "pending")
        .length
    : 0;

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
        {/* ① เช็คชื่อ — the attendance front door (spec 313: /team owns the entry;
            the cockpit stays project-scoped). Hidden when no current project. */}
        {isCrew && musterProjectId ? (
          <Link
            href={musterHref(musterProjectId)}
            className="bg-fill text-on-fill flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold"
          >
            <ScanLine aria-hidden className="size-4 shrink-0" />
            {MUSTER_LABEL}
          </Link>
        ) : null}

        {/* ② Crew sections — moved verbatim from /sa/crew (spec 298/306/282/279). */}
        {isCrew && projectList.length > 0 ? (
          <AddTechnicianSheet projects={projectList} qrCards={qrCards} firmQrCards={firmQrCards} />
        ) : null}
        {isCrew && projectList.length > 0 ? (
          <Link
            href="/team/badges"
            className="border-edge bg-card text-ink flex min-h-11 items-center justify-center rounded-lg border px-4 text-sm font-semibold"
          >
            พิมพ์บัตรช่าง (QR)
          </Link>
        ) : null}
        {isCrew ? (
          <CrewProgressRoster
            data={crewData}
            registrationsHref={withBackFrom("/sa/registrations", "/team")}
          />
        ) : null}
        {isCrew && siteBoard ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-body text-ink font-semibold">ทีมหน้างาน</h2>
            <SiteTeamBoard board={siteBoard} />
          </div>
        ) : null}

        {/* ③ คำขอสมัคร queue — approvers only (site_admin is NOT a member; its
            read-only nudge stays on /sa, and the pipeline above already shows รอตรวจ). */}
        {isApprover ? (
          <Link
            // Spec 313 U3: thread the referrer — this card is the phone's door to
            // the queue now that the คำขอสมัคร tab folded in here, so its back chip
            // must return to /team rather than the hardcoded /dashboard.
            href={withBackFrom("/registrations", "/team")}
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

        {/* ④ Back-office drill-downs — the roster + wages surfaces keep their URLs. */}
        {isBackOffice ? (
          <div className="grid grid-cols-2 gap-3">
            <Link
              href={withBackFrom("/workers", "/team")}
              className="rounded-card border-edge bg-card shadow-card hover:bg-sunk flex min-h-11 items-center justify-center gap-2 border px-4 py-3 text-sm font-semibold"
            >
              <HardHat aria-hidden className="size-4 shrink-0" />
              {WORKER_ROSTER_LABEL}
            </Link>
            <Link
              // Spec 313 U4 review follow-up: /team is a hub with NO back chip, so
              // a bare href let /payroll fall back to its own /settings parent —
              // ejecting the user somewhere they never came from. Its three sibling
              // drill-downs already threaded the referrer; this one was missed.
              href={withBackFrom("/payroll", "/team")}
              className="rounded-card border-edge bg-card shadow-card hover:bg-sunk flex min-h-11 items-center justify-center gap-2 border px-4 py-3 text-sm font-semibold"
            >
              <Wallet aria-hidden className="size-4 shrink-0" />
              ค่าแรง
            </Link>
          </div>
        ) : null}
      </section>
    </PageShell>
  );
}
