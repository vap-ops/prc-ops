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
import { clientEnv } from "@/lib/env";
import { technicianOnboardUrl } from "@/lib/register/onboard-link";
import { listVisibleTechnicianRegistrations } from "@/lib/register/admin-registrations";
import {
  CrewProgressRoster,
  type CrewProgressData,
  type CrewProgressMember,
} from "@/components/features/sa/crew-progress-roster";
import { CrewTeamRoster } from "@/components/features/sa/crew-team-roster";
import { buildCrewTeams } from "@/lib/sa/crew-teams";
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

  const [projectRes, workerRes, crewRes, memberRes, pendingRegistrations] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id, code, name").in("id", projectIds)
      : Promise.resolve({ data: null }),
    projectIds.length
      ? supabase
          .from("workers")
          .select("id, name, project_id, cost_confirmed_at, level")
          .eq("active", true)
          .in("project_id", projectIds)
          .order("name")
      : Promise.resolve({ data: null }),
    // Crews on the SA's projects (team dimension, U7b — readable via the site_admin
    // project-scoped read arm). default_day_rate is NOT selected (money zero-grant).
    projectIds.length
      ? supabase
          .from("crews")
          .select("id, name, lead_worker_id")
          .eq("active", true)
          .in("project_id", projectIds)
      : Promise.resolve({ data: null }),
    // Active membership (RLS-scoped to the SA's visible crews). Worker↔crew derives
    // from here (the SSOT); removed_at IS NULL = the current roster.
    projectIds.length
      ? supabase.from("crew_members").select("crew_id, worker_id").is("removed_at", null)
      : Promise.resolve({ data: null }),
    // /sa/registrations is the site_admin queue (RLS returns pending only);
    // super_admin uses /registrations, so it gets nothing here.
    ctx.role === "site_admin" ? listVisibleTechnicianRegistrations(supabase) : Promise.resolve([]),
  ]);

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

  // The crew (team) lens (U7b) — the same roster grouped by crew: each crew's lead
  // + members, plus the workers not yet on a crew. View-only for the SA.
  const teamData = buildCrewTeams(workerRows, crewRes.data ?? [], memberRes.data ?? []);

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

        {/* The team lens (U7b) — the same roster grouped by crew (name + lead + members),
            so it reads as teams-under-a-หัวหน้า. View-only; moves are PM-owned (U5). */}
        <div className="flex flex-col gap-3">
          <h2 className="text-body text-ink font-semibold">ทีม</h2>
          <CrewTeamRoster data={teamData} />
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
              แล้วมาอนุมัติในคำขอสมัครด้านบน
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
