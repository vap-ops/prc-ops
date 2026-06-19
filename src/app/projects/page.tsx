import { PageShell } from "@/components/features/chrome/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { AppHeader } from "@/components/features/chrome/app-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import {
  HubNav,
  PM_HUB_NAV,
  SA_HUB_NAV,
  PROCUREMENT_HUB_NAV,
  COORDINATOR_HUB_NAV,
} from "@/components/features/chrome/hub-nav";
import { EmptyNotice, ErrorNotice } from "@/components/features/common/notices";
import { StatusPill } from "@/components/features/common/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { PROJECT_VIEW_ROLES } from "@/lib/auth/role-home";
import { projectHref } from "@/lib/nav/project-paths";
import { NewProjectSheet } from "./new-project-sheet";
import { createClient } from "@/lib/db/server";
import { loadProjectsHub } from "@/lib/projects/load-hub";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import { projectStatusPillClasses } from "@/lib/status-colors";

// Spec 82 Unit 3: THE project hub — the content-named /projects, folded from
// the two role-named hubs (/sa for site_admin, /pm/projects for pm/super)
// that listed the same projects with the same row behaviour. One route, one
// query; the role only decides the chrome (kicker + desktop HubNav set), not
// the URL. Every project row opens the shared project page /projects/[id]
// (spec 59 WP-centric doctrine).

export const metadata = { title: "โครงการ" };

export default async function ProjectsHubPage() {
  const ctx = await requireRole(PROJECT_VIEW_ROLES);
  const supabase = await createClient();

  const isPm =
    ctx.role === "project_manager" ||
    ctx.role === "super_admin" ||
    ctx.role === "project_director";
  const isProcurement = ctx.role === "procurement";
  // Spec 143 U2: project_coordinator is the see-all oversight role.
  const isCoordinator = ctx.role === "project_coordinator";

  // Spec 148 U4: one loader batches the hub reads (was a serial waterfall). The
  // PM-only create-sheet data (suggested code + clients) joins the same fan as the
  // row client names. Same queries/columns/results — only the scheduling changes.
  const { projects, error, clientNames, suggestedCode, allClients } = await loadProjectsHub(
    supabase,
    isPm,
  );

  // Spec 102: procurement browses projects read-only for purchase context.
  const kicker = isCoordinator
    ? "ผู้ประสานงานโครงการ"
    : isProcurement
      ? "จัดซื้อ"
      : isPm
        ? "ผู้จัดการโครงการ"
        : "หน้างาน";
  const hubItems = isCoordinator
    ? COORDINATOR_HUB_NAV
    : isProcurement
      ? PROCUREMENT_HUB_NAV
      : isPm
        ? PM_HUB_NAV
        : SA_HUB_NAV;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker={kicker} fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />

      <HubNav maxWidthClass={PAGE_MAX_W} items={hubItems} currentHref="/projects" />

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          {/* SECTION_HEADING tokens minus its mb-3 — the row owns the gap so
              the h2 and the h-11 button center on each other (mb-3 + baseline
              alignment dropped the button below the heading). */}
          <h2 className="text-section text-ink font-semibold">โครงการ</h2>
          {isPm && <NewProjectSheet suggestedCode={suggestedCode} clients={allClients} />}
        </div>

        {error ? (
          <ErrorNotice>โหลดรายการโครงการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
        ) : !projects || projects.length === 0 ? (
          <EmptyNotice>ยังไม่มีโครงการ</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={projectHref(p.id)}
                  className="rounded-card border-edge bg-card shadow-card hover:bg-page focus-visible:ring-action active:bg-sunk flex min-h-14 items-center justify-between gap-3 border px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
                >
                  <div className="min-w-0">
                    <p className="text-ink-secondary font-mono text-xs">{p.code}</p>
                    <p className="text-ink truncate text-base font-medium">{p.name}</p>
                    {p.client_id && clientNames.get(p.client_id) && (
                      <p className="text-ink-secondary truncate text-xs">
                        ลูกค้า: {clientNames.get(p.client_id)}
                      </p>
                    )}
                  </div>
                  <StatusPill pillClasses={projectStatusPillClasses(p.status)}>
                    {PROJECT_STATUS_LABEL[p.status as keyof typeof PROJECT_STATUS_LABEL] ??
                      p.status}
                  </StatusPill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
