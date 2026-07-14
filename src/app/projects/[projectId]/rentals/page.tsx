// Spec 275 U5 — /projects/[id]/rentals: the equipment-rental recorder relocated
// from the settings hub (spec 268's /equipment/rentals) into the project. A
// rental is project-driven — "we wouldn't make any rentals without a related WP"
// (operator, 2026-07-07) — so the recorder lives at the project and auto-allocates
// every recorded rental to it. MONEY page: gated to BACK_OFFICE_ROLES (the exact
// create-RPC audience), so a site_admin session never reaches it (spec 46 /
// ADR 0055 decision 6). The two money tables are zero-authenticated-grant — read
// via the ADMIN client after the gate; project + supplier names via the RLS
// client. RentalManager renders project-LOCKED (hides the โครงการ pick + the
// per-card re-allocate). The settings /equipment/rentals page stays as
// procurement's cross-project overview.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { BACK_OFFICE_ROLES } from "@/lib/auth/role-home";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { RentalManager } from "@/components/features/equipment/rental-manager";
import {
  buildRentalView,
  rankRentalVendors,
  type RentalRatePeriod,
} from "@/lib/equipment/rental-view";
import { bangkokTodayISO } from "@/lib/work-packages/schedule-today";
import { projectHref } from "@/lib/nav/project-paths";
import { EQUIPMENT_RENTAL_LABEL } from "@/lib/i18n/labels";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export const metadata = { title: EQUIPMENT_RENTAL_LABEL };

export default async function ProjectRentalsPage({ params }: PageProps) {
  const { projectId } = await params;
  const ctx = await requireRole(BACK_OFFICE_ROLES);

  const supabase = await createServerSupabase();
  // RLS scopes the project read to the caller; an unseen/absent project 404s.
  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const admin = createAdminSupabase();
  // THIS project's rentals: the allocations bound to it name the batches to show.
  // A batch can span projects, but a project-scoped view carries only this
  // project's allocation chip for each — the cross-project picture stays on the
  // settings overview.
  const { data: allocationRows } = await admin
    .from("equipment_project_allocations")
    .select("id, batch_id, project_id, starts_on, ends_on")
    .eq("project_id", project.id)
    .order("starts_on", { ascending: true });
  const batchIds = [...new Set((allocationRows ?? []).map((a) => a.batch_id))];

  const [{ data: supplierRows }, { data: batchRows }] = await Promise.all([
    // Spec 280: a blacklisted supplier is not an option for a new rental.
    supabase
      .from("suppliers")
      .select("id, name")
      .neq("contact_status", "blacklisted")
      .order("name", { ascending: true }),
    batchIds.length > 0
      ? admin
          .from("equipment_rental_batches")
          .select(
            "id, supplier_id, monthly_rate, rate_period, starts_on, ends_on, note, status, created_at",
          )
          .in("id", batchIds)
      : Promise.resolve({ data: null }),
  ]);

  const suppliers = supplierRows ?? [];
  const project1 = [{ id: project.id, name: project.name }];
  // Spec 312: a voided (cancelled) batch is hidden here too.
  const visibleBatches = (batchRows ?? []).filter((b) => b.status !== "cancelled");
  // Spec 280: surface suppliers PRC has rented from before, above the full list.
  const rentalVendorIds = rankRentalVendors(visibleBatches);
  const rentals = buildRentalView(
    visibleBatches.map((b) => ({
      id: b.id,
      supplierId: b.supplier_id ?? "",
      rate: b.monthly_rate,
      ratePeriod: b.rate_period as RentalRatePeriod,
      startsOn: b.starts_on,
      endsOn: b.ends_on,
      note: b.note,
      status: b.status,
      createdAt: b.created_at,
    })),
    (allocationRows ?? []).map((a) => ({
      id: a.id,
      batchId: a.batch_id,
      projectId: a.project_id,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
    })),
    suppliers,
    project1,
  );

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={projectHref(project.id)} backLabel="กลับไปโครงการ">
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            {EQUIPMENT_RENTAL_LABEL} — {project.name}
          </h1>
        </div>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} px-5 py-6`}>
        <RentalManager
          suppliers={suppliers}
          suggestedSupplierIds={rentalVendorIds}
          projects={project1}
          rentals={rentals}
          defaultDate={bangkokTodayISO()}
          lockedProject={{ id: project.id, name: project.name }}
        />
      </div>
    </PageShell>
  );
}
