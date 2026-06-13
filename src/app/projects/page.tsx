import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { AppHeader } from "@/components/features/app-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { HubNav, PM_HUB_NAV, SA_HUB_NAV } from "@/components/features/hub-nav";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { SITE_STAFF_ROLES } from "@/lib/auth/role-home";
import { projectHref } from "@/lib/nav/project-paths";
import { createClient } from "@/lib/db/server";
import { SECTION_HEADING } from "@/lib/ui/classes";
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
  const ctx = await requireRole(SITE_STAFF_ROLES);
  const supabase = await createClient();

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, code, name, status, client_id")
    .order("code", { ascending: true });

  // Spec 79: resolve client names for the rows in one query (clients are
  // staff-readable, so the same line shows for SA as on the project detail).
  const clientIds = [
    ...new Set((projects ?? []).map((p) => p.client_id).filter((id): id is string => id !== null)),
  ];
  const { data: clientRows } = clientIds.length
    ? await supabase.from("clients").select("id, name").in("id", clientIds)
    : { data: [] };
  const clientNames = new Map((clientRows ?? []).map((c) => [c.id, c.name]));

  const isPm = ctx.role === "project_manager" || ctx.role === "super_admin";
  const kicker = isPm ? "ผู้จัดการโครงการ" : "หน้างาน";
  const hubItems = isPm ? PM_HUB_NAV : SA_HUB_NAV;

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker={kicker} fullName={ctx.fullName} maxWidthClass={PAGE_MAX_W} />

      <HubNav maxWidthClass={PAGE_MAX_W} items={hubItems} currentHref="/projects" />

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <h2 className={SECTION_HEADING}>โครงการ</h2>

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
                  className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 active:bg-zinc-100"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-zinc-600">{p.code}</p>
                    <p className="truncate text-base font-medium text-zinc-900">{p.name}</p>
                    {p.client_id && clientNames.get(p.client_id) && (
                      <p className="truncate text-xs text-zinc-600">
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
