import Link from "next/link";
import { AppHeader } from "@/components/features/app-header";
import { BottomTabBar } from "@/components/features/bottom-tab-bar";
import { HubNav, SA_HUB_NAV } from "@/components/features/hub-nav";
import { EmptyNotice, ErrorNotice } from "@/components/features/notices";
import { StatusPill } from "@/components/features/status-pill";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PROJECT_STATUS_LABEL } from "@/lib/i18n/labels";
import { projectStatusPillClasses } from "@/lib/status-colors";

export const metadata = { title: "โครงการ" };

export default async function SitAdminLandingPage() {
  const ctx = await requireRole(["site_admin", "project_manager", "super_admin"]);
  const supabase = await createClient();

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, code, name, status")
    .order("code", { ascending: true });

  return (
    <main className="min-h-screen bg-zinc-950 pb-20 text-zinc-100 sm:pb-0">
      <BottomTabBar role={ctx.role} />
      <AppHeader kicker="หน้างาน" fullName={ctx.fullName} maxWidthClass="max-w-2xl" />

      <HubNav maxWidthClass="max-w-2xl" items={SA_HUB_NAV} currentHref="/sa" />

      <section className="mx-auto max-w-2xl px-5 py-6">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">โครงการ</h2>

        {error ? (
          <ErrorNotice>โหลดรายการโครงการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</ErrorNotice>
        ) : !projects || projects.length === 0 ? (
          <EmptyNotice>ยังไม่มีโครงการ</EmptyNotice>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/sa/projects/${p.id}`}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-zinc-500">{p.code}</p>
                    <p className="truncate text-base font-medium text-zinc-100">{p.name}</p>
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
    </main>
  );
}
