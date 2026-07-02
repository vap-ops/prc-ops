// Spec 165 U3 — งวด (deliverable) detail page. The งวด's home: its identity,
// its งาน, and the planner edit affordance in one place. Drilled down from the
// project page's งวดงาน manager → renders DetailHeader (back chip to the
// #deliverables section). Read for PROJECT_VIEW_ROLES; rename for managers.

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { StatusPill } from "@/components/features/common/status-pill";
import { EmptyNotice } from "@/components/features/common/notices";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { requireRole } from "@/lib/auth/require-role";
import { PROJECT_VIEW_ROLES, isManagerRole } from "@/lib/auth/role-home";
import { projectSettingsHref, workPackageHref, deliverableHref } from "@/lib/nav/project-paths";
import { withBackFrom } from "@/lib/nav/back-href";
import { createClient } from "@/lib/db/server";
import { WORK_PACKAGE_STATUS_LABEL } from "@/lib/i18n/labels";
import { workPackageStatusPillClasses } from "@/lib/status-colors";
import { workPackageStatusIcon } from "@/lib/status-icons";
import { EditDeliverableSheet } from "../../edit-deliverable-sheet";
import { RemoveWorkPackagesSheet } from "../../remove-work-packages-sheet";
import { DeleteDeliverableButton } from "../../delete-deliverable-button";

interface PageProps {
  params: Promise<{ projectId: string; deliverableId: string }>;
}

export const metadata = { title: "งวดงาน" };

export default async function DeliverableDetailPage({ params }: PageProps) {
  const { projectId, deliverableId } = await params;
  const ctx = await requireRole(PROJECT_VIEW_ROLES);
  const supabase = await createClient();
  const isPmRole = isManagerRole(ctx.role);

  // RLS scopes deliverables to projects the caller can see; the project_id
  // filter pins the URL pair so a mismatched id 404s rather than leaking.
  const { data: deliverable } = await supabase
    .from("deliverables")
    .select("id, code, name, project_id")
    .eq("id", deliverableId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!deliverable) {
    notFound();
  }

  const { data: workPackages } = await supabase
    .from("work_packages")
    .select("id, code, name, status")
    .eq("deliverable_id", deliverableId)
    .order("code", { ascending: true });
  const wps = workPackages ?? [];

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader
        // Feedback f625f04d: the งวดงาน manager (this page's only entry point)
        // lives on the settings page now.
        backHref={`${projectSettingsHref(projectId)}#deliverables`}
        backLabel="กลับไปตั้งค่าโครงการ"
        actions={
          isPmRole ? (
            <EditDeliverableSheet
              projectId={projectId}
              deliverableId={deliverable.id}
              code={deliverable.code}
              name={deliverable.name}
            />
          ) : null
        }
      >
        <div>
          <p className="text-meta text-ink-secondary font-mono">{deliverable.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">{deliverable.name}</h1>
        </div>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-section text-ink font-semibold">
            งานในงวดนี้{" "}
            <span className="text-ink-muted text-sm font-normal">{wps.length} รายการ</span>
          </h2>
          {isPmRole &&
            (wps.length > 0 ? (
              <RemoveWorkPackagesSheet
                projectId={projectId}
                workPackages={wps.map((wp) => ({ id: wp.id, code: wp.code, name: wp.name }))}
              />
            ) : (
              <DeleteDeliverableButton projectId={projectId} deliverableId={deliverable.id} />
            ))}
        </div>

        {wps.length === 0 ? (
          <EmptyNotice>ยังไม่มีงานในงวดนี้ — จัดกลุ่มงานเข้างวดจากหน้าโครงการ</EmptyNotice>
        ) : (
          <ul className="rounded-card border-edge bg-card divide-edge divide-y border">
            {wps.map((wp) => (
              <li key={wp.id}>
                <Link
                  href={withBackFrom(
                    workPackageHref(projectId, wp.id),
                    deliverableHref(projectId, deliverableId),
                  )}
                  className="hover:bg-sunk focus-visible:ring-action flex items-center gap-3 px-4 py-3 transition-colors focus:outline-none focus-visible:ring-2"
                >
                  <span className="text-meta text-ink-secondary font-mono">{wp.code}</span>
                  <span className="text-body text-ink min-w-0 flex-1 truncate">{wp.name}</span>
                  <StatusPill
                    pillClasses={workPackageStatusPillClasses(wp.status)}
                    icon={workPackageStatusIcon(wp.status)}
                  >
                    {WORK_PACKAGE_STATUS_LABEL[wp.status]}
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
