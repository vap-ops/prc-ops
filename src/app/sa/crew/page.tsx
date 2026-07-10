// Spec 279 — SA-assisted technician onboarding. The roster is a staged progress
// tracker (U7): รอตรวจ (pending self-registrations) → รอยืนยัน (added, but a PM
// hasn't confirmed pay/level) → พร้อม (cost-confirmed). Below it: the SA's direct
// add (เพิ่มเอง, U4) + a per-project self-onboard QR (spec 264). Reads are
// RLS-scoped; money columns are zero-grant and never read here.

import QRCode from "qrcode";
import { ScanLine } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { requireRole } from "@/lib/auth/require-role";
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
import { AddWorkerForm } from "@/components/features/sa/add-worker-form";

export const metadata = { title: "ทีมงาน" };

const NO_NAME = "ยังไม่กรอกชื่อ";

export default async function SaCrewPage() {
  const ctx = await requireRole(["site_admin", "super_admin"]);
  const supabase = await createClient();

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

  const projectList = (projectRes.data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
  }));
  const projectCode = new Map(projectList.map((p) => [p.id, p.code]));
  const multiProject = projectIds.length > 1;

  const toMember = (w: {
    id: string;
    name: string;
    project_id: string | null;
    level: CrewProgressMember["level"];
  }): CrewProgressMember => {
    const label = multiProject && w.project_id ? projectCode.get(w.project_id) : undefined;
    return { id: w.id, name: w.name, level: w.level, ...(label ? { projectLabel: label } : {}) };
  };

  const workerRows = workerRes.data ?? [];
  const crewData: CrewProgressData = {
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

  const siteBoard = buildSiteTeamBoard({
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
  const qrCards = await Promise.all(
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

  return (
    <PageShell>
      <DetailHeader backHref="/sa" backLabel="กลับ">
        <h1 className={DETAIL_TITLE}>ทีมงาน</h1>
      </DetailHeader>
      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-6 px-5 py-6`}>
        {/* The onboarding pipeline the SA follows up on: รอตรวจ → รอยืนยัน → พร้อม (U7). */}
        <CrewProgressRoster data={crewData} registrationsHref="/sa/registrations" />

        {/* Spec 282 U2 — the site team board (approach A): on-site headcount split into
            ทีมภายใน / ทีมภายนอก / ฝ่ายไซต์ / ยังไม่ได้จัดทีม, crew cards collapse to their
            members + cross-charge badges. View-only; moves are PM-owned (spec 279 U5). */}
        <div className="flex flex-col gap-3">
          <h2 className="text-body text-ink font-semibold">ทีมหน้างาน</h2>
          <SiteTeamBoard board={siteBoard} />
        </div>

        {/* เพิ่มเอง (phoneless) — the SA types a ช่าง in directly (name + national-ID +
            DOB → sa_add_project_worker, U4). The primary path for the no-phone majority;
            the QR below is only for LINE-owning ช่าง. Shown where the SA has a project. */}
        {projectList.length > 0 ? <AddWorkerForm projects={projectList} /> : null}

        {/* Onboarding QR — one per project. The ช่าง scans the QR for the site
            they're at to self-register into THAT project. */}
        {qrCards.map(({ project, url, svg }) => (
          <div
            key={project.id}
            className="rounded-card border-edge bg-card shadow-card flex flex-col items-center gap-3 border p-5"
          >
            <div className="flex items-center gap-2 self-start">
              <ScanLine aria-hidden className="text-cat-w06 size-5 shrink-0" />
              <h2 className="text-body text-ink font-semibold">เพิ่มช่างใหม่ — {project.name}</h2>
            </div>
            <p className="text-ink-secondary text-center text-sm">
              ให้ช่างสแกน QR นี้ด้วยกล้องมือถือ เพื่อสมัครเข้าโครงการ{" "}
              <span className="text-ink font-medium">{project.name}</span> ด้วยตัวเอง
              แล้วมาตรวจในคำขอสมัครด้านบน
            </p>
            {/* qrcode → black-on-white SVG; wrapped white so it scans in any theme. */}
            <div
              className="rounded-lg bg-white p-3"
              aria-label={`QR สมัครเป็นช่าง — ${project.name}`}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="text-ink-muted text-meta text-center break-all">{url}</p>
          </div>
        ))}
      </section>
    </PageShell>
  );
}
