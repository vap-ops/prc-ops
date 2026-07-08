// Temporary — SA-assisted technician onboarding. Surfaces the crew roster (the
// SA's project workers, RLS-scoped, name only) and a self-onboard QR: the SA
// shows it, the ช่าง scans it with their phone camera → opens /register/technician
// → self-registers → the SA approves in /sa/registrations → they appear in the
// roster above. No new backend; reuses the shipped spec-264 self-onboarding.

import Link from "next/link";
import QRCode from "qrcode";
import { ClipboardList, ScanLine } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { DETAIL_TITLE } from "@/lib/ui/classes";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { clientEnv } from "@/lib/env";
import { technicianOnboardUrl } from "@/lib/register/onboard-link";
import { listVisibleTechnicianRegistrations } from "@/lib/register/admin-registrations";
import { CrewRosterList, type CrewRosterRow } from "@/components/features/sa/crew-roster-list";
import { AddWorkerForm } from "@/components/features/sa/add-worker-form";

export const metadata = { title: "ทีมงาน" };

export default async function SaCrewPage() {
  const ctx = await requireRole(["site_admin", "super_admin"]);
  const supabase = await createClient();

  // The SA's projects (RLS-scoped via their visible work packages, ADR 0056) →
  // the active workers on those projects (name + project only; money columns are
  // zero-grant and never read here).
  const { data: wpRows } = await supabase
    .from("work_packages")
    .select("project_id")
    .eq("is_group", false);
  const projectIds = Array.from(new Set((wpRows ?? []).map((w) => w.project_id)));

  const [projectRes, workerRes, pendingRegistrations] = await Promise.all([
    projectIds.length
      ? supabase.from("projects").select("id, code, name").in("id", projectIds)
      : Promise.resolve({ data: null }),
    projectIds.length
      ? supabase
          .from("workers")
          .select("id, name, project_id, cost_confirmed_at")
          .eq("active", true)
          .in("project_id", projectIds)
          .order("name")
      : Promise.resolve({ data: null }),
    // /sa/registrations is the site_admin queue; super_admin uses /registrations.
    ctx.role === "site_admin" ? listVisibleTechnicianRegistrations(supabase) : Promise.resolve([]),
  ]);

  const projectList = (projectRes.data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
  }));
  const projectCode = new Map(projectList.map((p) => [p.id, p.code]));
  const multiProject = projectIds.length > 1;
  const workers: CrewRosterRow[] = (workerRes.data ?? []).map((w) => {
    const label = multiProject && w.project_id ? projectCode.get(w.project_id) : undefined;
    return {
      id: w.id,
      name: w.name,
      pending: w.cost_confirmed_at === null,
      ...(label ? { projectLabel: label } : {}),
    };
  });
  const pendingRegCount = pendingRegistrations.length;

  // One QR per project the SA runs. Each carries its own project (+ the inviting
  // SA's id), so a ช่าง scanning the QR at a given site lands on
  // /register/technician already told WHICH project they're joining — they can
  // bail if they scanned the wrong site's code. Absolute URL so the QR resolves
  // from the ช่าง's own device. `by=ctx.id` rides along for F2b's invited-by
  // attribution (schema not landed yet; the QR is final now so it need not change).
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
        {/* Roster — the SA's project workers. Empty now (closes the loop with the QR). */}
        <div className="flex flex-col gap-3">
          <h2 className="text-meta text-ink-secondary font-semibold">ช่างในโครงการ</h2>
          <CrewRosterList workers={workers} />
        </div>

        {/* เพิ่มเอง (phoneless) — the SA types a ช่าง in directly (name + national-ID +
            DOB → sa_add_project_worker). The PRIMARY path for the no-phone majority;
            the QR below is only for LINE-owning ช่าง. Shown where the SA has a project. */}
        {projectList.length > 0 ? <AddWorkerForm projects={projectList} /> : null}

        {/* Approve queue — the pending self-registrations the SA acts on. */}
        <Link
          href="/sa/registrations"
          className="rounded-card border-edge bg-card shadow-card focus-visible:ring-action hover:bg-sunk flex items-center gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
        >
          <ClipboardList aria-hidden className="text-action size-5 shrink-0" />
          <span className="text-body text-ink min-w-0 flex-1 font-medium">คำขอสมัครรอตรวจ</span>
          {pendingRegCount > 0 ? (
            <span className="bg-action text-on-fill text-meta shrink-0 rounded-full px-2 py-0.5 font-bold">
              {pendingRegCount}
            </span>
          ) : null}
        </Link>

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
