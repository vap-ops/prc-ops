// Spec 300 U4 — the ของเข้า (incoming deliveries) surface, split off the store page. A
// time-sensitive receiving queue is a different intent from static inventory (คลัง), so it
// gets its own per-project route reached from the "ของเข้า" SA tile. Lists the project's
// incoming store-bound purchase requests, lens-filtered (วันนี้/กำลังมา/ทั้งหมด), each row
// linking to its receive card. Gated to WP_DETAIL_ROLES (the set that can open a project's
// store/WPs — admits the on-site site_admin); RLS scopes the rows to the visible project.

import { PageShell } from "@/components/features/chrome/page-shell";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { WP_DETAIL_ROLES } from "@/lib/auth/role-home";
import { createClient } from "@/lib/db/server";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { projectHref, incomingHref } from "@/lib/nav/project-paths";
import { StoreIncomingList } from "@/components/features/store/store-incoming-list";
import { selectStoreIncoming } from "@/lib/store/incoming";
import { parseIncomingLens, type IncomingLens } from "@/lib/purchasing/request-bands";
import { bangkokTodayISO } from "@/lib/work-packages/schedule-today";
import { STORE_INCOMING_HEADING } from "@/lib/i18n/labels";

interface PageProps {
  params: Promise<{ projectId: string }>;
  // Spec 300 U1/U4: the delivery lens (today | onroute | all).
  searchParams: Promise<{ incoming?: string | string[] }>;
}

export const metadata = { title: STORE_INCOMING_HEADING };

export default async function ProjectIncomingPage({ params, searchParams }: PageProps) {
  const { projectId } = await params;
  const { incoming } = await searchParams;
  const incomingLens = parseIncomingLens(typeof incoming === "string" ? incoming : null);
  const ctx = await requireRole(WP_DETAIL_ROLES);
  const supabase = await createClient();

  // RLS scopes the viewer to projects they can see; a hidden/absent project 404s.
  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  // Incoming store-bound deliveries — still `purchased`/`on_route` and WP-less; once
  // delivered the spec-195-P3 trigger auto-books them into the store, so they drop off.
  const { data: incomingRows } = await supabase
    .from("purchase_requests")
    .select(
      "id, item_description, quantity, unit, eta, status, supplier, catalog_items ( base_item, spec_attrs )",
    )
    .eq("project_id", project.id)
    .in("status", ["purchased", "on_route"])
    .is("work_package_id", null)
    // selectStoreIncoming re-sorts for display; this order only makes the cap deterministic.
    .order("eta", { ascending: true })
    .limit(200);

  const today = bangkokTodayISO();
  const incomingDeliveries = selectStoreIncoming(incomingRows ?? [], incomingLens, today);
  const path = incomingHref(project.id);
  const hrefFor = (l: IncomingLens) => (l === "today" ? path : `${path}?incoming=${l}`);

  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <DetailHeader backHref={projectHref(project.id)} backLabel="กลับไปโครงการ">
        <div>
          <p className="text-meta text-ink-secondary font-mono">{project.code}</p>
          <h1 className="text-title text-ink font-bold tracking-tight">
            {STORE_INCOMING_HEADING} — {project.name}
          </h1>
        </div>
      </DetailHeader>
      <div className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <StoreIncomingList rows={incomingDeliveries} lens={incomingLens} hrefFor={hrefFor} />
      </div>
    </PageShell>
  );
}
